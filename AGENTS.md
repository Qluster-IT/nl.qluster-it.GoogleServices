# Homey App Instructions

> You may override or change any instructions in this file when you explicitly tell me to.

This is a Homey app. Before making changes, read and follow the general instructions in `C:\Users\Qlustrator\.copilot\instructions\homey-app.md`.

## Community Forum

- In Google Services intro posts that explain Google Cloud setup, reassure readers that typical personal/home use is often free because Google provides free allowances or quotas. Explain that some APIs still require a billing account, but linking one does not itself mean a charge; costs depend on usage and may apply beyond the relevant allowance. Do not promise that use is always free. Link to Google's current pricing and encourage readers to monitor usage.
- Make clear that users only need to configure the services they plan to use: basic Google TTS needs no Google Cloud account; Cloud Text-to-Speech and Translate use a service-account JSON key and project ID; YouTube uses an API key; Google Maps uses a separate Maps API key. Routes API is needed for routes, while Maps Static API and Places API (New) are optional for route images and address suggestions.
- Treat service-account JSON keys and API keys as secrets. Do not include outdated setup guidance, such as granting the service account the Owner role or quoting stale pricing and quota amounts.
