# Homey App Instructions

> You may override or change any instructions in this file when you explicitly tell me to.

This is a Homey app. Before making changes, read and follow the general instructions in `C:\Users\Qlustrator\.copilot\instructions\homey-app.md`.

## Community Forum

- In Google Services intro posts that explain Google Cloud setup, reassure readers that typical personal/home use is often free because Google provides free allowances or quotas. Explain that some APIs still require a billing account, but linking one does not itself mean a charge; costs depend on usage and may apply beyond the relevant allowance. Do not promise that use is always free. Link to Google's current pricing and encourage readers to monitor usage.
- Make clear that users only need to configure the services they plan to use: basic Google TTS needs no Google Cloud account; Cloud Text-to-Speech and Translate use a service-account JSON key and project ID; YouTube uses an API key; Google Maps uses a separate Maps API key. Routes API is needed for routes, while Maps Static API and Places API (New) are optional for route images and address suggestions.
- Treat service-account JSON keys and API keys as secrets. Do not include outdated setup guidance, such as granting the service account the Owner role or quoting stale pricing and quota amounts.

## Speech testing

- Reuse saved Advanced Flows under Google Services, in the relevant device subfolder for single-device scenarios and at the app level for shared scenarios. Test Google TTS, Cloud TTS and Translate with a saved speaker, an explicit picker override and All speakers; obtain selections from the app's actual autocomplete.
- Check both states of Run When cards for speaker announcements. With direct playback, the disabled setting suppresses URL, translation and timed Finished triggers. Failed playback must not emit successful-announcement triggers.
- Include omitted device-backed Flow arguments, explicit zero pitch and volume gain, BLL coding with changed variable values, and preferred translation voices with regional default language codes.
- Test URL-trigger integration with a real speaker when authorized. Leave speaker-playing trigger fixtures disabled afterward so later announcements are not played twice.
- For managed announcements, verify original Sonos groups, queue positions, playback states and volumes return. Cover partial grouping failures, explicit volume zero, unsupported controls, user source/volume/group changes and queued announcements.
- Sonos topology can represent bonded speakers as nested `Satellite` elements. Include these when checking group membership and discovering stereo pairs; never control a bonded member independently.
- Prefer a stereo primary that already coordinates its own group when temporarily grouping rooms. On hardware, joining the primary to another coordinator can leave its hidden partner behind even though the visible room joins successfully.
- For TV-input regression tests, verify the exact original input and compare room membership and coordinators before and after the final announcement. Cover TV autoplay returning a room to its original group before cleanup.
- Sonos rooms can temporarily report different household topologies after a detach. Verify the detached room's own topology and transport instead of relying only on the former coordinator's view. In repeated hardware tests, start the next Flow only after observing the new clip and a stable restored state; an old stopped announcement URL is not evidence that the new clip played.
- A Sonos `Play` response does not confirm playback: a stream can remain `TRANSITIONING` while reconnecting. Verify the original URI and `PLAYING` before a queued announcement can take a new snapshot; if verification fails, stop the pending queue.
- During a Sonos handoff, keep the original snapshot for any room that has not been restored. For example, if A originally grouped with B and only A is needed for the next clip, detach B silently and verify that it rejoins A before the original source resumes.
- A Sonos detach can take effect even if its reply is lost. For example, if the former leader still lists B, check B's own topology and stopped transport before treating B as detached; never infer detachment from the error alone.
- For TV-exclusion tests, verify that excluded renderers receive no playback or volume commands. Also cover an included Sonos coordinator already grouped with an excluded soundbar: playing on the coordinator can reach the soundbar without sending it a direct command, so leave that group alone.
- For Cast receiver simulations, use realistic mDNS `md` (model) and decimal `ca` (capabilities) fields. `ca` bit 0 means video output, not that a physical TV is attached. Include audio-only and video models, plus known video models with missing `ca`; simulated dispatch does not verify playback or restoration on hardware.
- The AirPlay lab under `tools/airplay/` is excluded from the Homey package. Its PCM round trip verifies AirPlay 1 only. Before enabling AirPlay 2 on Homey, test actual audio output and verify the sender's PTP timing requirements (including UDP ports 319/320 for the evaluated sender); a successful session handshake does not prove that the receiver played audio.
- A reachable Sonos room can miss SSDP discovery. Check the household topology for missing visible rooms, verify each candidate's device identity, and compare the full topology across repeated announcement runs to catch intermittent omissions.
