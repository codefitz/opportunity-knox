# Smarter job intake

In **Add opportunity**, use the existing link lookup or enter details as usual. To read the source more thoroughly, paste the description or attach its file and use **Smarter job intake**. Choose Job link, Pasted job description or Attached file, then **Prepare intake review**. A newly attached file is selected automatically; pasted text is selected when there is no link/file.

**Ask Career Buddy to extract details** uses your saved chat provider/model. Only extracted job-source passages are sent, within the configured source budget; your Career Library/profile are not included. Turn it off to read/retain the source locally. If AI fails, the source-only review is labelled accordingly, without another inference attempt. PDF OCR is local and independently selectable. Progress/cancellation use existing request controls; cancelled/late results cannot create an opportunity.

The review shows suggested company, role, salary, location, working arrangement, employment type, contacts, reference, route and deadline where supported. Each accepted AI field cites a matching passage/quote, with PDF page/OCR labels where applicable. The service omits unsupported values, unknown fields and invented/repeated suggestions. Dates are normalized only with an explicit ISO or named-month day/year quote. This checks textual support, not whether the model interpreted the job correctly; inspect contradictions, salary periods, OCR errors and dates yourself. Missing information stays blank.

Choose the fields to apply and select **Use selected details & keep source**. Anything manually typed is preserved. Review/edit the form, then **Add opportunity**. The explicit save creates the record and three managed draft documents together:

- The full original source bytes: downloaded HTML/PDF, uploaded file or pasted UTF-8 text.
- Extracted text with PDF page markers.
- A review JSON report with source hashes/time/URLs, extraction/OCR method, selected provider/model/prompt version, supporting quotes, omissions/warnings and the actual saved fields alongside original suggestions.

Find them in the opportunity’s **Documents** tab. They do not appear in the Career Library, become indexed automatically or overwrite any submitted files. Full backups include these managed bytes and the record/report links; restore remaps their locations normally. A failed save rolls back metadata and cleans partial managed copies. An identical retry of a successful intake returns its existing opportunity; changed details require opening that record or preparing another review.

## Limits and source handling

- Sources: up to 15 MB; PDF, DOCX, TXT, Markdown and HTML files. Old binary `.doc` files need a PDF/DOCX/text copy for intake.
- Public URL reading keeps the existing public-only DNS pinning and redirect checks; no cookies/sign-in/CAPTCHA bypass. URL downloads retain the existing 2 MB transfer/decoded limit. Larger PDFs can be uploaded. JavaScript-dependent/blocked pages may require pasted text or a file. HTML snapshots preserve the downloaded response, not a rendered browser session or all linked assets. HTML is downloaded as an attachment rather than executed in the app.
- Native PDF text: first 40 pages. Sparse scanned pages: English OCR among the first 12 pages, up to 15 seconds per native tool and a 90-second OCR preparation budget. The full original PDF remains intact. Other languages and image content in DOCX are not handled by this PDF OCR flow. OCR can misread names, numbers and dates.
- Extracted text: up to 30,000 characters per PDF page and 300,000 overall; the opportunity description holds up to 200,000. Model input is further limited by the existing source budget. The UI warns when information was omitted.
- Temporary reviews: private host storage, 30-minute expiry, at most 20 pending previews, with periodic/startup cleanup. They are not server backups and the browser form is not a durable draft. Expired reviews must be prepared again; originals/manual input remain available. Consumed previews are removed after their source documents are saved.
- Reviewed intake currently starts from **New opportunity**. Existing opportunities retain quick link lookup, manual editing and ordinary document attachments. Global per-stage AI switches remain planned work.
