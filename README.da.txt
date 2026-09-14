Brug de nyeste Google Cloud Services, startende med den nye Text-to-Speech og Translate.

Translate
Du kan oprette en Google Translate-enhed og bruge den som handling eller tilstand til at oversætte, hvor oversættelsen vil være tilgængelig som en token for enheden.

Text-To-Speech
Kan bruges med enhver enhed, der tager en URL.

YouTube
Søg på YouTube og afspil det på YouTube eller en hvilken som helst enhed, der tager en URL.

Alle sprog, som Google understøtter, er understøttet.
Indstil stemme i indstillinger eller overskriv det i et flow.
Du kan indstille Pitch, Speed, Volume Gain og Device Profile pr. enhed (vil blive tilsidesat af flows med pitch og/eller hastighed).
SSML-kodning accepteres nu, som: <speak>Her er <say-as interpret-as=\"characters\">SSML</say-as> eksempler. <break time=\"3s\" />. Og fortsæt</speak>

Du kan også tilføje en præfiks og/eller suffiks pause gennem enhedsindstillingerne, hvilket er særligt nyttigt for Chromecast-brugere:
En pause tilføjet i begyndelsen vil adskille notifikationslyden og den faktiske tale.

Opret en Husholdningsenhed, der udløser alle gældende enheder til at sige "Middagen er klar!" eller bare en enhed til hovedrummet til at sige "Dørklokken ringer".
Du kan tilføje "enheder" så mange gange du vil, hver med sin egen udløser.
Betingelser er også tilgængelige!

Dette fungerer godt med andre apps som Sonos (Play (url) ved volume), Samsung Smart TV (Åbn Browser med URL) og IFTTT.

Se fællesskabsemnet for forklaring på, hvordan du får den nødvendige gratis Google Cloud Service Account (JSON-fil).

Der er også en gammel Google TTS-enhed med max. 200 tegn og begrænsede muligheder.

For at afspille det på selve Homey, se Media Url Converter.

* Valgfrit: Understøtter BLL-kodning.
Se indstillingerne for Better Logic Library App for, hvordan du bruger BLL-kodning.