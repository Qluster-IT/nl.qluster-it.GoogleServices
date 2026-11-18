Use Google Text-to-Speech, Translate and YouTube with Homey.


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

YouTube
Search YouTube using a Flow and use the returned video ID or link in other Flow cards.

## Google Maps

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/library), select the project that owns your Maps API key. Link a billing account and enable **Routes API**. Also enable **Maps Static API** if you want route images and **Places API (New)** for address suggestions during pairing and in the one-off Flow card.
2. In [Credentials](https://console.cloud.google.com/apis/credentials), restrict the dedicated key to the Maps APIs you enabled. Requests come from Homey, not your browser, so website/referrer restrictions won't work. If using IP restrictions, allow Homey's public outbound IP, not its local address.
3. Keep your existing key or enter it under **Google Maps → Maps API key** in Google Services app settings and select **Save settings**. No separate project ID or service account is needed for Maps. Do not change the Translate, Cloud Text-to-Speech, or YouTube credentials.
4. Pair a **Maps** device for each saved trip. New devices are named **Maps device** by default. During pairing, choose an origin and destination using address suggestions, or select **Use typed address** for a full address or `latitude, longitude`. Manual input remains available if Google suggestions cannot be loaded. Choose driving (traffic-aware), public transit, walking, or cycling, and whether to show a route image before adding the device. These options remain editable in device settings. Suggested locations are saved as `place_id:` followed by the Google place ID; replace this with an address or coordinates to change a location manually.

Address suggestions use **Places API (New)** when searching at least 3 characters; pairing waits for a half-second pause while typing, and the Flow card uses Homey's search input. To use your own input without this API, select the row showing your typed address or coordinates, with **Use typed address or coordinates** in its description. Only the typed value appears as the selection name on the Flow card. Under Google's global pay-as-you-go pricing, Autocomplete Requests have a separate free cap of **10,000 requests per month**, then charges apply; this app uses per-request billing, not unlimited session pricing. See [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing) and your Cloud Console for current allowances and actual usage.

Press **Refresh route** on the device or run **Refresh saved Google Maps route** in a Flow to update travel time, distance, and estimated arrival. There is no automatic polling or app-imposed refresh limit. Route images are on by default and require Maps Static API to be enabled and allowed for your Maps key. You can disable **Enable route images** in app settings or **Show route image** on the device; existing opt-outs are preserved. After refreshing the route, open the device's **Google Maps route** camera image. Homey requests the image only when needed and reuses it until the next device or Flow refresh, including when the camera view requests it repeatedly. Failed image requests are not retried automatically; refresh the route to try again. Image requests can incur a separate Maps Static API charge, so each device or Flow refresh can add usage.

In Advanced Flow, **Calculate a one-off Google Maps route** lets you search for both locations or select **Use typed address** for manual input. It returns minutes, kilometers, an ISO 8601 estimated arrival time, and an open-in-Google-Maps link, without updating the device's readings, settings, or image. Existing saved text inputs are still accepted when the Flow runs. Route availability varies by travel mode and region. Walking and cycling estimates may omit paths; check the route before traveling.

Maps also provides these device Flow cards:

- **When — Saved route refreshed:** runs after every successful saved-route refresh, with travel time, distance, arrival and Google Maps link tags.
- **When — Travel time changed:** compares successful refreshes and provides the previous time and the difference. The first reading after app startup or a route settings change does not trigger it.
- **When — Saved route refresh failed:** provides an error tag. Separate camera image requests and one-off calculations do not trigger this card.
- **And — Travel time exceeds a limit:** compares the last successful reading against a number of minutes. Reports an error if no reading exists.
- **And — Saved route results are available:** checks whether a successful reading exists. A failed refresh retains earlier results; restarting the app or changing route settings clears them.

The When cards do not refresh routes automatically, and the And cards do not contact Google. **Refresh route** is a momentary button: it resets after each press, even if refreshing fails, and does not enable automatic refreshing. **Last refreshed** shows the last successful saved-route refresh in Homey's local time, including seconds. Failed refreshes leave it unchanged; it clears with the other readings when the app restarts or route settings change.

Better Logic Library
BLL coding is optional in supported text fields. When Better Logic Library is unavailable, text is passed through unchanged and BLL expressions are not evaluated.
