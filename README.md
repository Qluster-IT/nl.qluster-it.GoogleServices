# Google Services

Use Google Text-to-Speech, Translate, YouTube and [Google Maps](#google-maps) with Homey.


Translate
Create a Google Translate device and use an action or condition to translate text. The original text and translation are available as device values; Advanced Flow actions also provide translation tokens.


For this you will need https://cloud.google.com/translate/docs/setup#api and enter the JSON and Project in the settings.


Text-To-Speech
Useable with any device that thakes an URL.

Cloud devices:
All languages that Google supports, are supported, because the settings are build from live data, so when a new language becames available, it will be for this App also.
Set a default voice in the app settings, or select a voice in a Flow card.
The Cloud voice list is cached for up to 10 minutes, including concurrent lookups.
Changing credentials, a failed lookup, or closing the speech server clears the
list and its expiry timer, so old clients are not retained by unused timers.
You can set Pitch, Speed, Volume Gain and Device Profile per device (will be overruled by flows with pitch and/or speed).

SSML coding is accepted now, like: <speak>Here are <say-as interpret-as=\"characters\">SSML</say-as> samples.<break time=\"3s\" />. And continue</speak>
https://cloud.google.com/text-to-speech/docs/ssml

Also you can add a prefix and/or suffix pause in the device settings, which is particularly useful for Chromecast users:
A pause added the beginning will separate the notification sound and the actual speech.

You get a URL for the audio that will be streamed through Homey, so the device eventually playing the mp3 file should be in the same network and have access.
The last 100 transcripts are stored in Homey's Memory for speed and less requests to Google Cloud (restart of app or Homey means reset of memory).
The cache keeps the 100 most recently used completed audio entries. Matching
device profiles reuse cached audio; failed synthesis is reported and is not
cached. Audio metadata parsing reuses the existing buffer instead of copying
the complete recording. Memory still depends on the size of those recordings.

Create a House device that triggers all applicable devices to say "Dinner is ready!" or just a device for the main room to say "The doorbell is ringing".
You can add "devices" as many times as you would like, each with its own trigger.
Conditions are also available! You can let a flow wait in de condition till speech is finished before turning to the Then part of the flow.

This works great with other Apps like Sonos (Play URL), Samsung Smart TV (Laung Browser with the URL), Sonos Say (Url) and IFTTT.


For this you wil need to generate your own Google Cloud Service Account at
https://cloud.google.com/text-to-speech/docs/libraries#setting_up_authentication
and fill-in the JSON in the settings.
Also you need to activate/add the "Cloud Text-to-Speech API" library in cloud.google.com.
In total, above is the same as step 1 , 2, 3, and 4 of https://cloud.google.com/text-to-speech/docs/quickstart-client-libraries?authuser=1#before-you-begin

Cloud Text-to-Speech requires billing. The monthly free allowance depends on the voice. See **Free usage & billing** in the app settings, and check [Google's current pricing](https://cloud.google.com/text-to-speech/pricing) and your Cloud Console usage before setting up frequent Flows.

After saving your credentials in app settings, use the test buttons for **Cloud Text-to-Speech**, **Translate**, **YouTube**, or **Google Maps**. Each button sends a sample request to Google, which can count toward quota or incur charges. Maps tests Routes, address suggestions, and route images separately; the last two are optional. A successful test confirms the sample request, not every voice, route, or billing tier.


There is the also old Google TTS device, with a max. 200 characters and limited options.
These languages are currently supported in Non-Cloud:
Engels (GB)
English (US)
Dutch (NL)
Dutch (BE)
German (DE)
German (LU)
French (FR)
French (BE)
Spanish (ES)
Italian (IT)
Swedish (SV)
Norwegian (NO)


For playing it on Homey itself, see Media Url Converter.

### Speaker announcements

Google TTS, Google Cloud TTS, and Google Translate each have a separate **Then** card for announcements. Choose **All speakers** or an individual device from the card's picker:

- **Google Cast:** Google Nest speakers and displays, Chromecast, and Chromecast Audio.
- **Sonos:** speakers, bonded stereo pairs, and soundbars.
- **UPnP/DLNA:** compatible speakers and AV receivers that offer AVTransport and support the announcement audio format. UPnP media servers alone cannot play announcements.

No separate Chromecast or Sonos Homey app is needed. Devices must be discoverable over IPv4 on Homey's local network and able to fetch audio from Homey (TCP port 47333).

The three **All speakers** options discover available targets for each announcement:

- **All speakers** includes every discovered target.
- **All speakers (no TVs)** skips recognized televisions and video-capable Cast receivers but includes recognized soundbars.
- **All speakers (no TVs or TV speakers)** also skips recognized soundbars and home theater speakers, regardless of which input they are using. If an included Sonos room is already grouped with an excluded room, that group is left alone.

The exclusions depend on the metadata devices advertise; an unrecognized device may still be included. Sonos discovery also checks the household's room list for reachable rooms that missed the network scan. **Temporarily group Sonos rooms** is on by default: the app pauses the group's existing audio before joining more rooms so it doesn't play on those rooms before the announcement. Compatible Sonos rooms play synchronized speech, then their original groups are restored. Bonded stereo members stay together. Other speakers and protocols play independently; universal UPnP/DLNA grouping is not supported.

Audio-only Cast targets such as Nest Mini and Chromecast Audio can still receive announcements with TV exclusions. Video-capable Cast targets such as Chromecast Ultra and Nest Hub are skipped. The app cannot determine what a Cast dongle is physically connected to or filter individual members of a Cast speaker group.

In **Pair** or **Repair**, choose a default speaker (including any of the **All speakers** options) and edit the device's settings. With a default output selected, ordinary speech and translation actions also play there. An explicit announcement-card speaker overrides the default; leaving it empty uses the device default. Without a default, the existing URL and translation cards keep their previous behavior.

To reuse the same speakers, open **Google Services → App settings → Speakers**, choose **Add group**, name it, select individual speakers, and save. The group appears in every announcement speaker picker, including **Pair** and **Repair**. Changes to membership apply to existing Flows and defaults without reselecting the group. Offline members are skipped; if none can play, the Flow reports an error. Saving a group does not change any speaker's permanent grouping.

In **Pair**, **Repair**, and **Saved groups**, speaker lists show the last discovered devices while Homey checks the network in the background. **Refresh speakers** forces a new scan. Flow card pickers cannot update a list after it is returned, so they use a recent scan or wait for discovery before showing speakers.

Set the **Sonos announcement mode** under **App settings → Speakers**. A speech device's **Advanced Settings** can override the app default, and an **Announce** Flow card can override both:

- **Play Separately:** Sends a native Sonos announcement directly to each selected room on supported speakers. It can start quickly and play over what’s already playing. Other rooms in the same Sonos group don’t hear it, and the group stays as it is. Sonos manages the background level; **Speaker volume (%)** only sets the announcement volume, subject to Sonos limits. The selected rooms may not start at exactly the same time. If a room can’t play the native announcement, the Flow reports an error instead of switching modes.
- **Play in Sync:** Compatible selected Sonos rooms play together and then return to their original groups. Existing devices and Flows keep their previous behavior, including the **Temporarily group Sonos rooms** setting, until a mode is explicitly changed. Existing groups that include excluded rooms may be left alone to avoid playing outside the selection.

For **Play Separately** on a single Sonos room or a saved group of Sonos rooms, Homey checks the last known addresses first and scans again if it can't verify them. Reserving fixed IP addresses for the speakers in your router helps avoid repeat scans.

A confirmed Sonos stereo pair appears as one **(Stereo)** target, with the left and right speaker models when available. Sonos plays the announcement through the bonded pair and handles synchronization. The card does not play through either side independently, and unrelated speakers with the same room name are not merged.

- **Google TTS — Announce text on a speaker:** Uses the device's language and supports up to 200 characters.
- **Google Cloud TTS — Announce text on a speaker:** Uses the existing Cloud TTS voice and audio settings and accepts SSML.
- **Google Translate — Translate and announce text on a speaker:** Uses the device's source language and the selected target language, or its default target when omitted. Basic Google TTS supports up to 200 characters of translated text. During **Pair** or **Repair**, opt into Cloud Text-to-Speech for this device and choose preferred voices by announcement language. If no voice is saved for the selected language, the app uses a matching Cloud voice or reports that the language isn't supported.

On a **Google Cloud TTS** device, choose and preview a voice when pairing or in **Repair**. Existing devices keep the app-wide voice unless you choose a device voice. A voice selected explicitly in a Flow card overrides both. For Translate, a preferred language voice also applies to a matching regional default (for example, Dutch with a Dutch (NL) voice and an `nl-NL` target); a voice from a different region is not substituted. **Advanced Settings** points to Repair for voice selection on both drivers. Generating a preview uses the Cloud Text-to-Speech API.

**Resume previous playback** is on by default. Previous sources, including Sonos TV/HDMI and line-in, and positions are restored where the speaker supports this; audio that was paused or stopped is not automatically played. After temporary Sonos grouping, the app verifies the original coordinator and speaker membership before resuming; if it cannot verify them, it reports an error instead of resuming on the wrong group. Non-seekable Sonos streams reconnect to the source rather than returning to an exact position. Sonos cloud queues may not be restorable, and Google Cast restoration supports the Default Media Receiver, not arbitrary Cast apps. Unsupported features are skipped without a warning; actual playback or restoration errors are reported. Grouping and resume can be switched off in Pair, Repair or Advanced Settings and only affect direct speaker playback, not URL-only Flows without a saved speaker.

The three announcement cards have an optional **Speaker volume (%)** argument (0–100). Leave it empty to keep the speaker's volume; zero is a valid override. Supported physical speaker volume is restored afterward unless it was changed during speech. Mute is not changed. This is separate from Cloud TTS volume gain.

In **Speakers → Saved groups**, use **Volume adjustment** to balance speakers and **Maximum volume** to cap the volume requested for each announcement. The adjustment adds or subtracts percentage points from the Flow volume, then the result is limited to zero and the member's maximum. For example, a Flow at 25% with a +15 adjustment and a 35% maximum requests 35%. If the Flow volume is blank, neither setting changes the speaker's volume.

Announcement actions continue the Flow after playback starts by default; cleanup runs in the background. Choose **wait to finish** to continue only after all announced speakers are finished and restored. The card fails if playback or restoration fails. When queued announcements can keep the same Sonos group leader, shared rooms stay grouped and keep their original playback snapshot. Other rooms return to their original groups as soon as possible. If one of those rooms needs a speaker still in use, it waits silently and rejoins before its original audio resumes. If the next announcement needs a different group leader, the app restores the original setup first. Before taking a new Sonos snapshot, the app checks that any source it restarted is playing again. If restoration fails, pending announcements are skipped rather than treating an incomplete restoration as the new baseline. Completion uses speaker status where supported and an estimated duration otherwise. Changing the source or group during speech can prevent restoration to avoid overwriting your changes. Restoration cannot be guaranteed if Homey restarts or loses power during the announcement. Existing Cloud **Say and wait** conditions still wait for the estimated duration and device delay. Optional voice, speed, pitch, volume gain and translation-language arguments use the device defaults when omitted; an explicit pitch or volume gain of zero remains an override.

Direct announcements do not fire **When** cards by default. In **Pair**, **Repair** or **Advanced Settings**, enable **Run When cards for speaker announcements** to also fire the audio URL card after playback starts successfully, or **Translation announced** on Translate devices. This toggle applies to Google Cast, Sonos and UPnP/DLNA playback. Cloud TTS also fires **Finished** based on the audio duration and configured delay, not a signal from the speaker. With the toggle off, direct playback does not fire these cards. An **All speakers** announcement that reports a failure does not fire them, even if some speakers started.

BLL coding is supported in marked text inputs, including speech, translation, YouTube searches and manually entered one-off Maps endpoints. Actual language, voice, speaker and Google Place selections remain picker identifiers, not BLL expressions.

YouTube
Search YouTube using a Flow and use the returned video ID or link in other Flow cards.

## Google Maps

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/library), select the project that owns your Maps API key. Link a billing account and enable **Routes API**. Also enable **Maps Static API** if you want route images and **Places API (New)** for address suggestions during pairing, repair, and in the one-off Flow card.
2. In [Credentials](https://console.cloud.google.com/apis/credentials), restrict the dedicated key to the Maps APIs you enabled. Requests come from Homey, not your browser, so website/referrer restrictions won't work. If using IP restrictions, allow Homey's public outbound IP, not its local address.
3. Keep your existing key or enter it under **Google Maps → Maps API key** in Google Services app settings and select **Save settings**. No separate project ID or service account is needed for Maps. Do not change the Translate, Cloud Text-to-Speech, or YouTube credentials.
4. Pair a **Maps** device for each saved trip. New devices are named **Maps device** by default. During pairing, choose an address suggestion or select the row showing your typed address or `latitude, longitude`. Manual input remains available if Google suggestions cannot be loaded. Choose driving (traffic-aware), public transit, walking, or cycling, and whether to show a route image before adding the device. All route options remain editable in **Advanced Settings**.
5. To change route settings, open **Repair** on the existing Maps device. You can edit both addresses with autocomplete or manual input, travel mode, and both image options. The device settings show readable addresses; Google Place IDs for selected suggestions are stored separately. If an older device still shows an ID, open **Repair** and save: this looks up the address using Places API (New). If lookup fails, you can enter the address yourself. Changing the route clears the previous readings and image; converting an ID to its address without changing the route keeps them. Use **Refresh route** or a Flow to calculate updated results when needed.

In **Pair**, **Repair**, or **Advanced Settings**, you can choose **Use Homey's location** independently for the origin and destination. The app uses Homey's configured location, not your phone's. Homey's current coordinates are sent to Google only when you refresh a route that uses this option.

Driving routes show **Estimated traffic delay** when Google provides the with-traffic and without-traffic estimates. For driving images, **Show traffic on route images** is on by default in both app and device settings. Green means normal traffic, orange means slow traffic, red means a jam, and blue is used where no traffic category is drawn. Turning either switch off applies on the next refresh and does not disable the delay reading. Requests with traffic colors use the [Google Routes Enterprise tier](https://developers.google.com/maps/billing-and-pricing/sku-details/routes#compute-routes-ent-sku); images still use Maps Static API separately. The image is a snapshot, not a live traffic layer.

Address suggestions use **Places API (New)** when searching at least 3 characters; pairing and repair wait for a half-second pause while typing, and the Flow card uses Homey's search input. To use your own input without this API, save what you typed in Repair or select the row showing your typed address or coordinates during pairing or in a Flow. Under Google's global pay-as-you-go pricing, Autocomplete Requests have a separate free cap of **10,000 requests per month**, then charges apply; this app uses per-request billing, not unlimited session pricing. See [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing) and your Cloud Console for current allowances and actual usage.

Press **Refresh route** on the device or run **Refresh saved Google Maps route** in a Flow to update travel time, distance, and estimated arrival. There is no automatic polling or app-imposed refresh limit. Route images are on by default and require Maps Static API to be enabled and allowed for your Maps key. You can disable **Enable route images** in app settings or **Show route image** on the device; existing opt-outs are preserved. After refreshing the route, open the device's **Google Maps route** camera image. Homey requests the image only when needed and reuses it until the next device or Flow refresh, including when the camera view requests it repeatedly. Failed image requests are not retried automatically; refresh the route to try again. Image requests can incur a separate Maps Static API charge, so each device or Flow refresh can add usage.

To see **Leave by** on a Maps device, set **Arrive by** in **Advanced Settings** using `YYYY-MM-DD HH:mm` in Homey's time zone, and optionally set a **Departure buffer** in minutes. The device subtracts the latest travel estimate and buffer from that arrival deadline. Check **Last refreshed** to see how current the estimate is, and refresh the route if needed. This is based on the last route calculation, not a forecast for the planned departure time. Changing the deadline or buffer does not make another Google request. Clear the deadline to hide the reading; if you set it on an existing device and no time appears, refresh the route once.
In Advanced Flow, **Calculate a one-off Google Maps route** lets you choose address suggestions or select your typed input for either location. It returns minutes, kilometers, an ISO 8601 estimated arrival time, and an open-in-Google-Maps link, without updating the device's readings, settings, or image. Existing saved text inputs are still accepted when the Flow runs. Route availability varies by travel mode and region. Walking and cycling estimates may omit paths; check the route before traveling.

The **A new route estimate takes longer than a limit** condition checks a fresh Google Maps estimate between two locations in one card. It makes a Routes API request each time it runs, without requiring a Maps device or requesting an image. An estimate equal to the threshold does not count as longer.

Maps also provides these device Flow cards:

- **When — Saved route refreshed:** runs after every successful saved-route refresh, with travel time, distance, arrival and Google Maps link tags.
- **When — Travel time changed:** compares successful refreshes and provides the previous time and the difference. The first reading after app startup or a route settings change does not trigger it.
- **When — Saved route refresh failed:** provides an error tag. Separate camera image requests and one-off calculations do not trigger this card.
- **And — Travel time exceeds a limit:** compares the last successful reading against a number of minutes. Reports an error if no reading exists.
- **And — Saved route results are available:** checks whether a successful reading exists. Results persist after a failed refresh or app restart; changing route settings clears them.

The When cards do not refresh routes automatically, and the And cards do not contact Google. **Refresh route** is a momentary button: it stays active during an update, ignores additional presses until the update completes, and does not enable automatic refreshing. **Last refreshed** uses the same format as **Estimated arrival**: the date and time in Homey's time zone, without the year or seconds. Readings, refresh time, and the last loaded route image are retained across app restarts. Failed refreshes leave the previous results unchanged; changing route settings clears them.

Better Logic Library
BLL coding is optional in supported text fields. When Better Logic Library is unavailable, text is passed through unchanged and BLL expressions are not evaluated.

## Changelog

### 3.1.1

- Clarified the Sonos announcement options: **Play Separately** sends a native announcement to the chosen rooms, while **Play in Sync** plays it across rooms together.

### 3.1.0

- Use **Play Separately** for quick, native Sonos announcements that play over your current audio in the rooms you choose. Use **Play in Sync** when the rooms need to play together.
- Speaker lists open faster in Pair, Repair, and Saved groups, and refresh in the background.
- Test Cloud Text-to-Speech, Translate, YouTube, and Maps from app settings, with separate checks for optional Maps features.
- Set **Arrive by** and a **Departure buffer** on a Maps device to see **Leave by**.

### 3.0.0
- Create reusable speaker groups for Flows or as the default output, with volume adjustments and limits for each speaker.
- For Google Cast, Sonos, and compatible UPnP/DLNA devices, choose All speakers, All speakers (no TVs), or All speakers (no TVs or TV speakers).
- Sonos announcements play in order and restore original groups and playback, including TV and line-in where supported.
- Announcement cards can continue right away or wait until the speakers have finished.

### 2.2.1

- Maps has clearer reading names and is now included in the app images. Flow cards identify text fields that support Better Logic Library coding.

### 2.2.0

- Announce text or translations directly on Google Cast, Sonos, and compatible UPnP/DLNA speakers. Sonos stereo pairs appear as one target with left and right details when available. Choose and preview Cloud voices per device. Google Maps can use Homey's location and show estimated traffic delays.

### 2.1.1

- Google Maps now retains route results and the last loaded route image across app restarts. The refresh button ignores additional presses while an update is in progress.

### 2.1.0

- Save Google Maps routes with address suggestions or manual input. See travel time, distance, estimated arrival, and route images on demand.
- Use **Refresh route** or a Flow to update a saved route. **Last refreshed** shows when it last succeeded. There is no automatic polling.
- Calculate one-off routes in Advanced Flow, react to route updates or failures, and check saved travel times in Flow conditions.

### 2.0.4

- Fixed Google Translate language lookup and translation. Improved speech reliability, device pairing and memory usage.

### 2.0.3

- Changed sourcecode and issues from Bitbucket to GitHub.

### 2.0.2

- Improved: New design, images and logo's.

### 1.11.0

- Translated: Translated into all supported languages.

### 1.10.2

- Resolved: Non-Cloud TTS could not be created on the HP2023.

### 1.10.1

- Improved: Default flowcard now also contains an option source-language.

### 1.10.0

- Bugfixed: Translate AF flowcard.
- Languages added to Translate (all supported language by Google).

### 1.9.52

- Dependencies update.

### 1.9.51

- Bugfixed: Solved another potential HP2023 startup bug.

### 1.9.50

- Bugfixed: Another startup issue resolved.

### 1.9.49

- Improved: Memory performance.

### 1.9.48

- Improved: Memory performance.

### 1.9.47

- Improved: Memory performance.

### 1.9.46

- Bugfixed: Startup issues finally resolved.

### 1.9.45

- Bugfixed: Working on startup issues on older models.

### 1.9.44

- Bugfixed: Working on startup issues on older models.

### 1.9.43

- Bugfixed: Working on startup issues on older models.

### 1.9.42

- Bugfixed: Working on startup issues on older models.

### 1.9.41

- Bugfixed: No more startup issues!

### 1.9.40

- Bugfixed: TEST VERSION: might contain a bug!

### 1.9.39

- Bugfixed: Startup issues.

### 1.9.38

- Bugfixed: Startup issues.

### 1.9.37

- Improved: Bll updates while running.

### 1.9.36

- Resolved a bug (normal version again): No start-up.

### 1.9.35

- Resolving a bug (test version): No start-up.

### 1.9.34

- Resolving a bug: No start-up.

### 1.9.33

- Resolving a bug: No start-up.

### 1.9.32

- Resolved: One-time notification about BLL coding back.

### 1.9.31

- Improved: Removed some useless logging.

### 1.9.30

- Improved: Works with all Homey Pro's again.

### 1.9.29

- Improved: Works with Early 2023 (i hope)!

### 1.9.28

- Improved: Works with Early 2023!

### 1.9.27

- Bugfixed: Startup fault when the old Better Logic is installed.

### 1.9.26

- Improved: Startup Error message.

### 1.9.25

- Bugfixed: Error when Better Logic Library was not installed.

### 1.9.24

- Supported: Better Logic Library coding can now be used within Translate flowcards.

### 1.9.23

- Supported: Better Logic Library coding can now be used within Translate flowcards.

### 1.9.22

- Supported: Better Logic Library coding can now be used within flowcards.

### 1.9.21

- Support added: Better Logic Library coding can now be used within flowcards.

### 1.9.20

- Support added: Better Logic Library coding can now be used within flowcards.

### 1.9.19

- Added: Contribution options: Patreon and GithubSponsors (with PayPal already available).

### 1.9.18

- Added: Added Audio Encoding on Google TTS Device Settings.

### 1.9.17

- Improved: Added Google AND and THEN card with text, speed, pitch and volume.

### 1.9.16

- Improved: Store Tags.

### 1.9.15

- Improved: More notifications about why the json is not working.

### 1.9.14

- Removed startup.

### 1.9.13

- Improved startup.

### 1.9.12

- Improved Error handling.

### 1.9.11

- Improved Store tags.

### 1.9.10

- Bug fixed missing capabilities for older devices.

### 1.9.9

- Bug fixed tokens.

### 1.9.7

- Advanced Flows supported: Then cards with tokens are added.

### 1.9.2

- Bug fixed

### 1.9.1

- Improved hints

### 1.9.0

- Improved flowcard descriptions

### 1.8.9

- Added a YouTube device for searching YouTube

### 1.8.8

- Fixes App startup

### 1.8.7

- Fixes

### 1.8.4

- Fixed debugging issue

### 1.8.3

- Added volume-gain (including voice/language) to flowcards

### 1.8.2

- Added volume-gain to flowcards

### 1.8.1

- Added device-setting for always using SSML, so you wont need to write the <speak> element

### 1.8.0

- Added device-setting for adding <speak> by default to speechoutput, so you won't need to anymore

### 1.7.9

- Updated readme

### 1.7.8

- changed Readme

### 1.7.7

- Added prefix and suffix pause to TTS Device settings, particularly useful for Chromecast users

### 1.7.6

- Added prefix and suffix pause to TTS Device settings, particularly useful for Chromecast users

### 1.7.4

- Added Volume Gain and Device Profile to CloudTTS device settings and SDK3

### 1.7.3

- Added Volume Gain and Device Profile to CloudTTS device settings

### 1.7.2

- Added Volume Gain and Device Profile to CloudTTS device settings

### 1.7.1

- Added Volume Gain and Device Profile to CloudTTS device settings

### 1.6.6

- Improved json

### 1.6.5

- Flow arg title fixed

### 1.6.4

- added word example to setting JSON placeholder

### 1.6.3

- Added notification if Google response with an error (like Bandwidth excausted, meaning quota reached)

### 1.6.2

- Fix flow title uniqueness

### 1.6.1

- Added projectname to settings

### 1.6.0

- Google Cloud Translate added as device with a condition card

### 1.4.3

- condition returns true if succesfull

### 1.4.2

- Bugfixed

### 1.4.1

- Added conditions with waiting for speech to complete

### 1.4.0

- Added Get URL as conditions so the url and duration are available in the Then part of the same flow

### 1.3.2

- Added url and duration as capability so its available as tokens

### 1.3.0

- Added finished trigger (you can use it to for example shutdown Sonos Repeat)

### 1.2.4

- smaller in size (MB)

### 1.2.3

- trash coding removed

### 1.2.2

- Settings work on phone

### 1.2.1

- Bugfixed

### 1.2.0

- Ready for the world to speak to

### 1.1.4

- Fixed Settingsscreen so no restart of app is necessary

### 1.1.3

- Fixes and added duration as tokens to flowactions for Sonos Say

### 1.1.1

- SSML coding is accepted now, like: <speak>Here are <say-as interpret-as="characters">SSML</say-as> samples.<break time="3s" />. And continue</speak>

### 1.1.0

- Google Cloud Added, and everything that cames with it.

### 1.0.0

- First published version
