Bruk de nyeste Google Cloud-tjenestene, start med den nye Text-to-Speech og Translate.

Translate
Du kan opprette en Google Translate-enhet og bruke den som en handling eller en betingelse for oversettelse, der oversettelsen vil være tilgjengelig som et token fra enheten.

Text-To-Speech
Brukbar med enhver enhet som tar en URL.

YouTube
Søk på YouTube og spill av på YouTube eller hvilken som helst enhet som tar en URL.

Alle språk som støttes av Google, er støttet.
Sett stemme i innstillingene eller overstyr det i en flow.
Du kan sette Tonehøyde, Hastighet, Volumøkning og Enhetsprofil per enhet (vil bli overstyrt av flows med tonehøyde og/eller hastighet).
SSML-koding godtas nå, som: <speak>Her er <say-as interpret-as=\"characters\">SSML</say-as> eksempler.<break time=\"3s\" />. Og fortsett</speak>

Du kan også legge til et prefiks og/eller et suffiks pause gjennom enhetsinnstillingene, noe som er spesielt nyttig for Chromecast-brukere: 
En pause lagt inn i begynnelsen vil skille varsellyden fra selve talen.

Lag en Huseenhet som utløser alle relevante enheter til å si "Middagen er klar!" eller bare en enhet for hovedrommet til å si "Dørklokken ringer".
Du kan legge til "enheter" så mange ganger du vil, hver med sin egen utløsning.
Betingelser er også tilgjengelige!

Dette fungerer flott med andre Apper som Sonos (Spill av (url) på volum), Samsung Smart TV (Start nettleser med URL) og IFTTT.

Se fellesskapets emne for forklaring om hvordan du får den nødvendige gratis Google Cloud Service-konto (JSON-fil).

Det finnes også en gammel Google TTS-enhet, med maks. 200 tegn og begrensede alternativer.

For å spille det av på Homey selv, se Media Url Converter.

* Valgfritt: Støtter BLL-koding. 
Se Better Logic Library App Innstillinger for hvordan du bruker BLL-koding.