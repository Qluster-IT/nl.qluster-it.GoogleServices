Use the newest Google Cloud Services, starting with the new Text-to-Speech and Translate.

Translate
U can make a Google Translate device and use it as action or a condition to translate, of which the transalation will be available as a tokenvalue of the device.

Text-To-Speech
Useable with any device that takes an URL.

All languages that Google supports, are supported.
Set voice in settings or overwrite it in a flow.
You can set Pitch and Speed per device (will be overruled by flows with pitch and/or speed).
SSML coding is accepted now, like: <speak>Here are <say-as interpret-as=\"characters\">SSML</say-as> samples.<break time=\"3s\" />. And continue</speak>


Create a House device that triggers all applicable devices to say "Dinner is ready!" or just a device for the main room to say "The doorbell is ringing".
You can add "devices" as many times as you would like, each with its own trigger.
Conditions are also available!

This works great with other Apps like Sonos (Play Audio Clip), Samsung Smart TV (Laung Browser with the URL) and IFTTT.


Set the community topic for explanation on how to get the necessary free Google Cloud Service Account.

There is the also old Google TTS device, with a max. 200 characters and limited options.


For playing it on Homey itself, see Media Url Converter.