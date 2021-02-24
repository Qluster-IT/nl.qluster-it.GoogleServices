Use the newest Google Cloud Services, starting with the new Text-to-Speech and Translate.

Translate
U can make a Google Translate device and use it as a condition to translate, of which the transalation will be available as a tokenvalue of the device.

Text-To-Speech
Useable with each device that thakes an URL.

All languages that Google supports, are supported.
Currently you can only set the Voice in the settings, but it will be setable per device in the near future.
You can set Pitch and Speed per device (will be overruled by flows with pitch and/or speed).
SSML coding is accepted now, like: <speak>Here are <say-as interpret-as=\"characters\">SSML</say-as> samples.<break time=\"3s\" />. And continue</speak>

You get a URL for the audio that will be streamed through Homey, so the device eventually playing the mp3 file should be in the same network and have access.

Create a House device that triggers all applicable devices to say "Dinner is ready!" or just a device for the main room to say "The doorbell is ringing".
You can add "devices" as many times as you would like, each with its own trigger.
Conditions are also available!

This works great with other Apps like Sonos (Play URL), Samsung Smart TV (Laung Browser with the URL), Sonos Say (Url) and IFTTT.


For this you will need to follow step 1 , 2, 3, and 4 of https://cloud.google.com/text-to-speech/docs/quickstart-client-libraries?authuser=1#before-you-begin
See the community forum or issues site for more information.

There is the also old Google TTS device, with a max. 200 characters and limited options.

For playing it on Homey itself, see Media Url Converter





