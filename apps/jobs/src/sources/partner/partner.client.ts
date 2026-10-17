import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type {
  CommitmentRow,
  CompanyRow,
  DealRow,
  FirmRow,
  FundRow,
  MetricRow,
  PersonRow,
} from './partner.parser';

/**
 * Reads the partner snapshot from the `partner_stage` schema.
 *
 * The snapshot is loaded INTO the capbase database as its own schema
 * (`make partner-stage-load`) and dropped after the run
 * (`make partner-stage-drop`), so this reads over the same DATABASE_URL as
 * everything else — there is no second connection. Prisma manages `public`
 * only; it never sees these tables.
 *
 * Every read is keyset-paged in id order, so a page is bounded whatever the
 * table size. Numeric columns are cast to float8/int in SQL (the driver would
 * otherwise return decimals), and dates are read as `YYYY-MM-DD` text so the
 * worker's timezone can never move one by a day.
 */
@Injectable()
export class PartnerClient {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether the stage schema is loaded at all. */
  async stageLoaded(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ loaded: boolean }[]>`
      SELECT to_regclass('partner_stage.firm') IS NOT NULL AS loaded`;
    return rows[0]?.loaded === true;
  }

  async allFirms(): Promise<FirmRow[]> {
    return this.prisma.$queryRaw<FirmRow[]>`
      SELECT firm_id, name, role, manager_firm_type, lp_firm_type, country, city, website,
             year_established::int AS year_established, about, aum_usd::float8 AS aum_usd,
             vc_fund_share::float8 AS vc_fund_share, deal_count::int AS deal_count
        FROM partner_stage.firm
       ORDER BY firm_id`;
  }

  async people(firmIds: string[]): Promise<PersonRow[]> {
    if (firmIds.length === 0) return [];
    return this.prisma.$queryRaw<PersonRow[]>`
      SELECT contact_id, firm_id, name, job_title, email, phone, linkedin
        FROM partner_stage.person
       WHERE firm_id = ANY(${firmIds})
       ORDER BY firm_id, contact_id`;
  }

  async funds(after: string, limit: number): Promise<FundRow[]> {
    return this.prisma.$queryRaw<FundRow[]>`
      SELECT fund_id, manager_id, name, status, asset_class, vintage::int AS vintage, currency,
             size_usd::float8 AS size_usd, target_usd::float8 AS target_usd,
             hard_cap_usd::float8 AS hard_cap_usd, to_char(launch_date, 'YYYY-MM-DD') AS launch_date,
             to_char(latest_close_date, 'YYYY-MM-DD') AS latest_close_date,
             to_char(final_close_date, 'YYYY-MM-DD') AS final_close_date,
             mgmt_fee_pct::float8 AS mgmt_fee_pct, carry_pct::float8 AS carry_pct,
             hurdle_pct::float8 AS hurdle_pct, irr_net_min::float8 AS irr_net_min,
             irr_net_max::float8 AS irr_net_max, irr_gross_min::float8 AS irr_gross_min,
             irr_gross_max::float8 AS irr_gross_max, region_focus, city, country
        FROM partner_stage.fund
       WHERE fund_id > ${after}
       ORDER BY fund_id
       LIMIT ${limit}`;
  }

  async companies(after: string, limit: number): Promise<CompanyRow[]> {
    return this.prisma.$queryRaw<CompanyRow[]>`
      SELECT company_id, name, country, city, website, industry, verticals, about, status
        FROM partner_stage.company
       WHERE company_id > ${after}
       ORDER BY company_id
       LIMIT ${limit}`;
  }

  async deals(companyIds: string[]): Promise<DealRow[]> {
    if (companyIds.length === 0) return [];
    return this.prisma.$queryRaw<DealRow[]>`
      SELECT deal_id, company_id, to_char(deal_date, 'YYYY-MM-DD') AS deal_date, stage, status, currency,
             size_local::float8 AS size_local, size_usd::float8 AS size_usd
        FROM partner_stage.deal
       WHERE company_id = ANY(${companyIds})`;
  }

  async dealInvestors(dealIds: string[]): Promise<{ deal_id: string; firm_id: string }[]> {
    if (dealIds.length === 0) return [];
    return this.prisma.$queryRaw<{ deal_id: string; firm_id: string }[]>`
      SELECT deal_id, firm_id FROM partner_stage.deal_investor WHERE deal_id = ANY(${dealIds})`;
  }

  async commitments(after: [string, string], limit: number): Promise<CommitmentRow[]> {
    return this.prisma.$queryRaw<CommitmentRow[]>`
      SELECT c.fund_id, c.firm_id, c.amount_local::float8 AS amount_local,
             f.name AS fund_name, f.manager_id, f.currency AS fund_currency, f.vintage::int AS vintage
        FROM partner_stage.commitment c
        JOIN partner_stage.fund f ON f.fund_id = c.fund_id
       WHERE (c.fund_id, c.firm_id) > (${after[0]}, ${after[1]})
       ORDER BY c.fund_id, c.firm_id
       LIMIT ${limit}`;
  }

  async metrics(after: [string, string], limit: number): Promise<MetricRow[]> {
    return this.prisma.$queryRaw<MetricRow[]>`
      SELECT m.fund_id, to_char(m.as_at, 'YYYY-MM-DD') AS as_at, m.dry_powder_local::float8 AS dry_powder_local,
             m.aum_usd::float8 AS aum_usd, m.unrealized_local::float8 AS unrealized_local,
             f.name AS fund_name, f.manager_id, f.currency AS fund_currency
        FROM partner_stage.fund_metric m
        JOIN partner_stage.fund f ON f.fund_id = m.fund_id
       WHERE (m.fund_id, m.as_at) > (${after[0]}, ${after[1]}::date)
       ORDER BY m.fund_id, m.as_at
       LIMIT ${limit}`;
  }
}
