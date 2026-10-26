/** Research targets only. These names do not establish an applicant/company match. */
export interface PatentPilotCompany {
  key: string;
  legalName: string;
  jurisdiction: string;
  cohort: 'patent-producing' | 'subsidiary' | 'common-name' | 'low-expected-coverage';
  identityReference: string;
  identityVerified: false;
}

export const PATENT_PILOT_SAMPLE: readonly PatentPilotCompany[] = [
  ['apple', 'Apple Inc.', 'US', 'patent-producing', 'https://www.apple.com/legal/'],
  ['ibm', 'International Business Machines Corporation', 'US', 'patent-producing', 'https://www.ibm.com/investor'],
  ['qualcomm', 'QUALCOMM Incorporated', 'US', 'patent-producing', 'https://investor.qualcomm.com/'],
  ['samsung', 'Samsung Electronics Co., Ltd.', 'KR', 'patent-producing', 'https://www.samsung.com/global/ir/'],
  ['toyota', 'Toyota Motor Corporation', 'JP', 'patent-producing', 'https://global.toyota/en/ir/'],
  ['canon', 'Canon Kabushiki Kaisha', 'JP', 'patent-producing', 'https://global.canon/en/ir/'],
  ['siemens', 'Siemens Aktiengesellschaft', 'DE', 'patent-producing', 'https://www.siemens.com/global/en/company/investor-relations.html'],
  ['bosch', 'Robert Bosch GmbH', 'DE', 'patent-producing', 'https://www.bosch.com/corporate-information/'],
  ['philips', 'Koninklijke Philips N.V.', 'NL', 'patent-producing', 'https://www.philips.com/a-w/about/investor-relations.html'],
  ['ericsson', 'Telefonaktiebolaget LM Ericsson', 'SE', 'patent-producing', 'https://www.ericsson.com/en/investors'],
  ['tsmc', 'Taiwan Semiconductor Manufacturing Company Limited', 'TW', 'patent-producing', 'https://investor.tsmc.com/'],
  ['huawei', 'Huawei Technologies Co., Ltd.', 'CN', 'patent-producing', 'https://www.huawei.com/en/corporate-information'],
  ['cochlear', 'Cochlear Limited', 'AU', 'patent-producing', 'https://www.cochlear.com/'],
  ['csl', 'CSL Limited', 'AU', 'patent-producing', 'https://www.csl.com/investors'],
  ['dyson', 'Dyson Technology Limited', 'GB', 'subsidiary', 'https://www.dyson.co.uk/'],
  ['arm', 'Arm Limited', 'GB', 'subsidiary', 'https://www.arm.com/company/policies'],
  ['google', 'Google LLC', 'US', 'subsidiary', 'https://abc.xyz/investor/'],
  ['microsoft-licensing', 'Microsoft Technology Licensing, LLC', 'US', 'subsidiary', 'https://www.microsoft.com/en-us/legal/intellectualproperty/'],
  ['nokia-technologies', 'Nokia Technologies Oy', 'FI', 'subsidiary', 'https://www.nokia.com/about-us/'],
  ['sony-semiconductor', 'Sony Semiconductor Solutions Corporation', 'JP', 'subsidiary', 'https://www.sony-semicon.com/en/company/'],
  ['orange', 'Orange', 'FR', 'common-name', 'https://www.orange.com/en'],
  ['next', 'NEXT plc', 'GB', 'common-name', 'https://www.nextplc.co.uk/'],
  ['block', 'Block, Inc.', 'US', 'common-name', 'https://investors.block.xyz/'],
  ['gitlab', 'GitLab Inc.', 'US', 'low-expected-coverage', 'https://ir.gitlab.com/'],
  ['basecamp', '37signals LLC', 'US', 'low-expected-coverage', 'https://37signals.com/'],
].map(([key, legalName, jurisdiction, cohort, identityReference]) => ({
  key: key!, legalName: legalName!, jurisdiction: jurisdiction!,
  cohort: cohort as PatentPilotCompany['cohort'], identityReference: identityReference!, identityVerified: false,
}));
