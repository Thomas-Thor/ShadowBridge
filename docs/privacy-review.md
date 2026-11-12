# Privacy policy review

This PR prepares a concise English Global Privacy Policy at `/privacy/` and a
discreet homepage footer link. It covers international activity, GDPR where
applicable and other applicable privacy laws. It does not
publish the policy, modify n8n/OAuth/production configuration, or authorise a
deployment. Keep the PR in draft until the owner completes the disclosures below.

## Evidence and boundaries

- `index.html` and `assets/app.js`: name, email, optional company, role, message
  and optional sector are assembled locally. Email uses `mailto:`; download uses
  a browser Blob; copy uses the clipboard. There is no direct form upload or
  Google sign-in, analytics code, cookie write or persistent enquiry storage.
- Fonts and visual assets are local. `cartel/index.html` is an information page
  with no registration or login form. Shared styles remain unchanged.
- The repository has `.nojekyll`, a `CNAME` for `shadow-bridge.eu`, and static
  HTML. A directory index supplies `/privacy/` without a new server or router.
- Owner operational material describes n8n synchronising business CRM records
  with Google Sheets. It does not establish the current OAuth client scopes or
  which records this particular client handles. No private operational URLs,
  account/credential IDs, personal records or secrets are included in this PR.
- No n8n credential configuration or actual Google consent request was available
  for verification. **There is no verified scope list.** Do not substitute the
  default scopes of an n8n credential type, or infer a grant from the app name.
- Live inspection was attempted through both HTTP and web browsing. The HTTP
  proxy rejected `https://shadow-bridge.eu/` with CONNECT 403; web browsing also
  could not retrieve the site. Local checks cannot establish deployed content,
  server-side cookies, headers/logging or production routing. Recheck the live
  site and any difference from this source before publication.

## Information the owner must complete before publication

| Information | Required detail |
| --- | --- |
| Controller and contact | Full legal name, postal address, establishment country, privacy contact; representative/DPO details if applicable. The published business email is confirmed in source, not as a dedicated privacy address. |
| Actual Google access and processing | Sanitised exact scope URIs from this client's authorisation request and consent screen, their meanings and necessity; connecting users, workflow purpose, fields and sources, read/write/create/delete operations, onward destinations and human access; whether received enquiries enter the workflow. Include any identity, Drive or metadata scope actually requested. |
| Lawful bases | GDPR Article 6 basis per actual purpose, including correspondence, CRM/Sheets, logs/security and rights requests; any relied-on legitimate interests, specific legal obligations or consent withdrawal arrangements. |
| Providers and transfers | Actual legal entities/roles for hosting/CDN, email, Google and n8n hosting, staff/contractors and other recipients, data/countries involved, applicable transfer mechanisms and access to safeguards; production cookies/tracking and logs. |
| Retention and safeguards | Actual periods or criteria for email/attachments, CRM and Google data, tokens, execution/error/server logs and backups; deletion/disconnection process and exceptions; verified transport/storage protection, credential handling, access/sharing, logs, backups and incident handling. |
| Google data use and decisions | Confirm limits on use, sharing and human access, sale/advertising/AI training practices, applicability and compliance with Google's Limited Use requirements; confirm profiling or significant automated decisions, with required disclosures if applicable. |
| Effective date | Owner-approved date after completing the notice. Replace all marked text, remove the draft banner and change the policy robots meta to `index, follow` only when approved. |

For scopes, explain the permission's full capability separately from the
workflow's narrower use. For example, a scope covering all spreadsheets cannot
be described as a grant for a single workflow-selected file. The draft intentionally
does not list hypothetical permissions as active permissions or make unverified
promises about encryption, retention, data sale, AI use or Limited Use compliance.

## Reference material

- [Google Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Google Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google account connections](https://myaccount.google.com/connections)
- [GDPR, especially Articles 12–22](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)
- [EEA supervisory authorities](https://www.edpb.europa.eu/about-edpb/about-edpb/members_en)

## Focused validation

No build is required. From the repository root:

```sh
python3 -m unittest discover -s tests -v
node tests/privacy-browser.cjs
git diff --check
```

The browser check requires Python 3, Node 18+, Playwright and Chromium. Use an
existing Playwright install, or install it outside the published site, e.g.
`npm install --prefix /tmp/shadowbridge-privacy-test --no-save --no-package-lock playwright`,
then set `NODE_PATH=/tmp/shadowbridge-privacy-test/node_modules`. Set
`CHROMIUM_PATH=/usr/bin/chromium` for a system browser, or use Playwright's
installed browser. Optional `PRIVACY_SCREENSHOT_DIR` saves screenshots; no
screenshots or test dependencies are served with the site.

Checks cover local navigation/anchors/assets/fonts and sitemap, document
landmarks, homepage-to-policy-to-home navigation, 320/390/768/1440 px layouts,
sticky-header anchor visibility, JS-disabled reading/navigation, console/asset
errors, absence of remote data requests/browser storage, and existing enquiry
download/email-draft behaviour with test data and external mail navigation
prevented. No test submits an enquiry, grants OAuth access or runs n8n.

After owner approval and deployment, verify an unauthenticated HTTPS GET to
`https://shadow-bridge.eu/privacy/`, the live footer link and assets, and the
final scope disclosures against the consent screen. Entering the URL into the
OAuth console is outside this PR.
