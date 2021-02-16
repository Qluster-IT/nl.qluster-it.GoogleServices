Create a device per room and/or for the whole home.
Start a speech flow for that device and it will trigger a flow with an URL.

This works great with other Apps like Sonos (Play URL) and Samsung Smart TV (Laung Browser with the URL) and IFTTT.

Create a House device that triggers all applicable devices to say "Dinner is ready!" or just a device for the main room to say "The doorbell is ringing".
You can add "devices" as many times as you would like, each with its own trigger.


There is the old Google TTS device, with a max. 200 characters and limited options.

There are also Google Cloud devices, using the newest Google Cloud Services.
For this you wil need to generate your own Google Cloud Service Account at
https://cloud.google.com/text-to-speech/docs/libraries#setting_up_authentication
and fill-in the JSON in the settings.
Also you need to activate/add the "Cloud Text-to-Speech API" library in cloud.google.com.
It's free upto 4 million characters per month. (I have disabled WaveNet at the moment).



Cloud devices:
All languages that Google supports, are supported, because the settings are build from live data, so when a new language becames available, it will be for this App also.
Currently you can only set the Voice in the settings, but it will be setable per device in the near futher.
You can set Pitch and Speed per device (will be overruled by flows with pitch and/or speed).

The audio is streamed through Homey, so the device eventially playing the file should be in the same network and have access.
The last 100 transcripts are stored in Homey's Memory for speed and less requests to Google Cloud.


Non-CLoud device:
A max of 200 characters is allowed.
You can set the output language per device.
When creating a device it will be configured based on your own language.

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



Working on playing this on Homey itself.

