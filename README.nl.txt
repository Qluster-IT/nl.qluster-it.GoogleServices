Gebruik de nieuwste Google Cloud Services, te beginnen met de nieuwe Text-to-Speech en Translate.

Vertalen
Je kunt een Google Translate-apparaat maken en dit gebruiken als actie of voorwaarde om te vertalen, waarvan de vertaling beschikbaar zal zijn als een token van het apparaat.

Text-To-Speech
Te gebruiken met elk apparaat dat een URL accepteert.

YouTube
Zoek YouTube en speel het af op YouTube of een willekeurig apparaat dat een URL accepteert.

Alle talen die door Google worden ondersteund, worden ondersteund.
Stel de stem in via de instellingen of overschrijf deze in een flow.
Je kunt Toonhoogte, Snelheid, Volumetoename en Apparaatprofiel per apparaat instellen (wordt overruled door flows met toonhoogte en/of snelheid).
SSML-codering wordt nu geaccepteerd, zoals: <speak>Hier zijn <say-as interpret-as=\"characters\">SSML</say-as> voorbeelden.<break time=\"3s\" />. En ga verder</speak>

Je kunt ook een voorvoegsel en/of achtervoegsel pauze toevoegen via de apparaatinstellingen, wat vooral handig is voor Chromecast-gebruikers:
Een pauze aan het begin scheidt het meldingsgeluid van de daadwerkelijke spraak.

Maak een Huis-apparaat dat alle toepasselijke apparaten triggert om te zeggen "Het eten is klaar!" of gewoon een apparaat voor de hoofdruimte om te zeggen "De deurbel gaat".
Je kunt "apparaten" zo vaak toevoegen als je wilt, elk met zijn eigen trigger.
Voorwaarden zijn ook beschikbaar!

Dit werkt geweldig met andere apps zoals Sonos (Afspelen (url) op volume), Samsung Smart TV (Start Browser met de URL) en IFTTT.

Zie het community-onderwerp voor uitleg over hoe je de benodigde gratis Google Cloud Service-account (JSON-bestand) krijgt.

Er is ook een oud Google TTS-apparaat, met een max. van 200 tekens en beperkte opties.

Voor het afspelen op Homey zelf, zie Media Url Converter.

* Optioneel: Ondersteunt BLL-codering.
Zie de Better Logic Library App-instellingen voor hoe je BLL-codering gebruikt.