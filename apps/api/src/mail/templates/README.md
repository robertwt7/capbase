# Email templates

Every transactional email Capbase sends lives here as a pair of files: the HTML body and the
plain-text body. The API reads them at boot (`../templates.ts`), fills the placeholders and sends
both bodies through Resend. **These files are the source of truth** — there are no Resend hosted
templates and nothing to copy into the Resend dashboard.

| Template              | Sent when                                                  | Placeholders                        |
| --------------------- | ---------------------------------------------------------- | ----------------------------------- |
| `verify-email`        | on register, on resend, and after an email change          | `NAME`, `LINK`                      |
| `password-reset`      | on forgot-password                                         | `NAME`, `LINK`                      |
| `welcome`             | once, when an account first verifies its email             | `NAME`, `SITE_URL`                  |
| `submission-approved` | a moderator publishes a contribution                       | `NAME`, `SUMMARY`, `LINK`           |
| `submission-rejected` | a moderator turns one down (`REASON` = note or stock line) | `NAME`, `SUMMARY`, `REASON`, `LINK` |

Subjects live in the `TEMPLATES` registry in `../templates.ts`, not in the files.

## Conventions

- **Placeholders are `{{{UPPER_SNAKE}}}`** — the same syntax Resend's hosted templates use, so a
  file can be pasted into the Resend dashboard unchanged if that's ever wanted. `{{{SUBJECT}}}`
  is filled automatically (the HTML `<title>`); every other placeholder must be listed in the
  template's `vars` in `TEMPLATES`. `templates.spec.ts` fails if a file and the registry drift.
- Values are **HTML-escaped** in the `.html` body (a user's name is user input) and inserted
  verbatim in the `.txt` body. A placeholder with no value throws rather than shipping a literal
  `{{{NAME}}}` to an inbox.
- Every `.html` is **standalone**: its own `<!doctype html>`, `<head>` and inline styles only, no
  partials. The shell is duplicated across files on purpose, so each opens (or pastes) as-is.
- Layout is **table-based**: email clients (Outlook especially) don't do flexbox or grid.
- Colours are the "parchment ledger" tokens from `apps/web/app/globals.css`, **hand-copied as
  hex** because email clients don't support CSS custom properties. This is the one sanctioned
  exception to "never hardcode hex"; the comment at the top of each file maps hex → token:
  - paper `#f0ece3` (page ground) · surface `#f7f4ee` (the card) · line `#ded8cc` (borders)
  - ink `#141210` (headings, the button) · graphite-700 `#4a453d` (body) · graphite-500 `#6e675c` (muted)
- **Monochrome only**: no accent colours, no gradients, no pure `#fff`, and no images (clients
  block them by default — the wordmark is mono uppercase text).
- Fonts name `IBM Plex Sans` / `IBM Plex Mono` / `Archivo` first and fall back to system stacks.
  No webfonts are loaded; most clients ignore them.
- A hidden preheader `<div>` right after `<body>` is the inbox preview line.
- Every button link is repeated as a plain URL underneath, for clients that strip buttons.
- Keep the `.txt` saying the same thing as the `.html`.

## Adding a template

1. Add `<name>.html` and `<name>.txt` here.
2. Register it in `TEMPLATES` (`../templates.ts`) with its subject and `vars`.
3. Add a `send…Email` method on `MailService` that calls `deliver('<name>', …)`.
4. Add sample values for it in `../preview.ts`.

The build copies `*.html`/`*.txt` into `dist/mail/templates/` via the `assets` entry in
`apps/api/nest-cli.json`.

## Previewing

```sh
make mail-preview
```

writes every template, filled with sample values, to `apps/api/.mail-preview/` (gitignored) plus
an `index.html` linking them. Open that in a browser and narrow the window to check phone width.
