Använd de senaste Google Cloud-tjänsterna, börjar med den nya Text-till-Tal och Översättning.

Översätt
Du kan skapa en Google Translate-enhet och använda den som en åtgärd eller ett villkor för att översätta, där översättningen blir tillgänglig som en token i enheten.

Text-till-Tal
Användbar med alla enheter som tar en URL.

YouTube
Sök på YouTube och spela upp det på YouTube eller vilken enhet som helst som tar en URL.

Alla språk som Google stöder är också stödda här.
Ställ in röst i inställningarna eller skriv över den i ett flöde.
Du kan ställa in tonhöjd, hastighet, volymförstärkning och enhetsprofil per enhet (kommer att ersättas av flöden med tonhöjd och/eller hastighet).
SSML-kodning accepteras nu, till exempel: <speak>Här är <say-as interpret-as=\"characters\">SSML</say-as> exempel.<break time=\"3s\" />. Och fortsätt</speak>

Du kan också lägga till ett prefix- och/eller suffix-paus via enhetsinställningarna, vilket är särskilt användbart för Chromecast-användare:
En paus i början kommer att separera notifikationsljudet och det faktiska talet.

Skapa en Hem-enhet som triggar alla tillämpliga enheter att säga "Maten är klar!" eller bara en enhet för huvudrummet att säga "Dörrklockan ringer".
Du kan lägga till "enheter" så många gånger du vill, varje med sin egen trigger.
Villkor är också tillgängliga!

Detta fungerar utmärkt med andra appar som Sonos (Spela (url) på volym), Samsung Smart TV (Starta webbläsare med URL) och IFTTT.

Se community-ämnet för förklaring om hur du får det nödvändiga kostnadsfria Google Cloud Service Account (JSON-fil).

Det finns också en gammal Google TTS-enhet, med max. 200 tecken och begränsade alternativ.

För att spela det på Homey själv, se Media Url Converter.

* Valfritt: Stödjer BLL-kodning.
Se appinställningar för Better Logic Library för hur du använder BLL-kodning.