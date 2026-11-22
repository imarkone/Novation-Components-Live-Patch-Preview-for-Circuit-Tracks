# Príručka – Circuit Tracks Patch Preview a generátor náhodných zvukov

Verzia rozšírenia 0.8.2

## Čo rozšírenie robí

Rozšírenie pre Chrome a Edge pridáva do webu Novation Components náhľad patchov a generátor náhodných zvukov pre Circuit Tracks (ďalej CT). Generátor hýbe gombíkmi priamo v editore, takže vidíš, čo vytvoril, a môžeš to dolaďovať.

| Časť | Kde | Čo robí |
| --- | --- | --- |
| Náhľad patchov | Packs → Patches | Zahrá vybraný patch na CT ešte pred nahratím. |
| Náhodný zvuk | Synth → editor | Random, Mutuj, Krížiť, Snapshot A/B, história. |
| Prehrávanie | panel editora | Play, Loop, úryvky Melódia / Akordy / Jedna nota. |
| Súbory | panel editora | Otvoriť a uložiť .syx, debug JSON. |
| Nahrávanie | panel editora | WAV z výstupu CT, dávka .syx → WAV, kontrola hlasitosti. |

**Čo potrebuješ:**

- Chrome alebo Edge na počítači (Web MIDI so SysEx).
- CT pripojenú cez USB.
- Na nahrávanie a kontrolu hlasitosti zvukovku (napr. Behringer UMC404HD): CT neposiela zvuk cez USB, takže jej výstup L/R musíš zapojiť do vstupov zvukovky.

Rozšírenie beží len na stránke components.novationmusic.com, nemá účet ani server a všetky MIDI a zvukové dáta zostávajú v tvojom počítači.

## Inštalácia a aktualizácia

Pri každej novej verzii nahraď celý priečinok rozšírenia a skontroluj číslo verzie v paneli.

1. Stiahni ZIP verzie (alebo repozitár z GitHubu) a rozbaľ ho. Otvor priečinok, v ktorom je `manifest.json`.
2. Otvor `chrome://extensions` (v Edge `edge://extensions`) a zapni **Developer mode**.
3. Prvý raz: **Load unpacked** a vyber ten priečinok. Pri aktualizácii nahraď obsah priečinka novým a pri rozšírení klikni na **Reload** (šípka v kruhu).
4. Obnov stránku Components (F5). Pri prvom spustení povoľ MIDI a SysEx.
5. Otvor **Circuit Tracks → Synth** a otvor alebo vytvor patch. Vpravo hore sa zobrazí panel **Náhodný zvuk v0.8.2**.

**Kontrola verzie:** číslo za názvom panela sa číta z `manifest.json`, ktorý Chrome naozaj načítal. Ak po Reloade vidíš staré číslo, nová verzia sa nenačítala: skontroluj priečinok a daj Reload znova.

**Upozornenie v Extensions:** do verzie 0.7.6 tam Chrome hlásil zastaranú funkciu `createScriptProcessor`. Od 0.8.0 sa nahráva cez AudioWorklet a upozornenie zmizne; staré hlásenie vymažeš tlačidlom **Clear all**.

## Náhľad patchov (Packs)

Na stránke **Circuit Tracks → Packs → Patches** vyber obsadený slot. Pod **Category** sa objavia tri tlačidlá:

| Tlačidlo | Čo zahrá |
| --- | --- |
| Single C3/C5 | MIDI noty 48 a 72. |
| Melody | Dvojtaktové arpeggio c mol, 144 BPM. |
| Chords | Krátke akordy. |

Rozšírenie si zapamätá aktuálny patch Synth 1, dočasne nahrá vybraný zvuk, zahrá noty a pôvodný patch vráti. Do packu ani do slotu sa nič nezapíše.

## Panel Náhodný zvuk

Panel je v editore vpravo hore. **Zbaliť** ho skryje, **EN/SK** prepne jazyk.

| Ovládanie | Čo robí |
| --- | --- |
| Typ zvuku | Ľubovoľný, Bass, Lead, Pad, Pluck, Keys, Bell, String, Arp, Movement, FX. Random berie časti len z patchov tej kategórie (podľa kategórie uloženej v patchi: Bell = zvony, String = sláčiky, Arp = arpeggio, Movement = pohyblivé zvuky), Ľubovoľný zo všetkých. Bell a Movement majú menej donorov (asi 20), preto sa zvuky viac podobajú. |
| Intenzita | Divokosť. 0 = čisté časti skutočných patchov, 100 = náhodné odchýlky, extrémny chorus/phaser a distortion, extra modulácie v matici. Pri Mutuj veľkosť zmeny. |
| Random | Nový zvuk: oscilátory + mixer + voice z jedného skutočného patchu, filter, obálky, LFO, efekty a matica z iných. Mení všetky odomknuté skupiny. |
| Mutuj | Jemne posunie aktuálny zvuk, charakter zostane. |
| Späť | Vráti zvuk pred posledným Random, Mutuj, Krížením alebo Otvoriť .syx. |
| Stop | Zastaví prehrávanie, Loop aj dávku. |
| Zámky skupín | Zaškrtnutá skupina sa nemení (napr. zamkni Filter a hľadaj len nové oscilátory). |
| História | Posledných 20 zvukov. Klik vráti zvuk do editora, ★ ho označí ako obľúbený a ponechá ho natrvalo. Pri zvuku je jeho pôvod: „Otvorené · Názov“ pre otvorený .syx, „Mutuj · Názov“ pre mutáciu otvoreného zvuku, „Kríženie · A×B“ pre potomka. |

**Odkiaľ berie Random zvuky:** z 542 skutočných patchov (Novation packy, YBC Big City a Delorean Dream) v súbore `data/corpus.csv`. Vyššia intenzita pridá náhodu navyše.

**Bezpečnostné pravidlá:** minimálna úroveň mixera, žiadny nekonečný release, semitóny oscilátorov najviac ±24, žiadna modulácia, ktorá vypne zdroj. Každé pravidlo mení nanajvýš pár skutočných patchov; hlasitosť rieši kontrola hlasitosti.

## Kríženie obľúbených a Snapshot A/B

**Kríženie** vytvorí „dieťa“ dvoch zvukov označených ★. Opakovaným krížením najlepších sa dá zvuk postupne vyšľachtiť.

1. V histórii označ ★ aspoň dva zvuky.
2. V sekcii **Kríženie obľúbených** vyber **Rodič A** a **Rodič B**.
3. Klikni **🧬 Krížiť**. Každé kliknutie dá iného potomka.
4. Dobrého potomka označ ★ a kríž ho ďalej s iným rodičom.

Ako vzniká potomok: každý dostane vlastnú „blízkosť“ k A alebo B. Gombíky sú medzi hodnotou A a B, prepínače (vlna, typ filtra, tvar LFO, mono/poly), oktáva a semitóny sú od jedného z rodičov, matica celá od jedného z nich. Intenzita pridá náhodné hodnoty niektorým gombíkom. Zámky skupín platia aj tu.

**Snapshot A/B** slúži na porovnanie pri dolaďovaní.

1. **📷 Snapshot** uloží aktuálny zvuk.
2. Upravuj gombíky alebo skúšaj Random.
3. **A/B** prepne editor na uložený zvuk; ďalšie kliknutie späť. Tlačidlo ukazuje, ktorú stranu počuješ.

Pri zapnutom „Po zmene zahrať úryvok“ sa po každom prepnutí úryvok zahrá.

## Prehrávanie

Panel prehrá krátky úryvok na CT cez MIDI, aby si zvuk počul bez klaviatúry.

| Ovládanie | Čo robí |
| --- | --- |
| Po zmene zahrať úryvok | Po Random, Mutuj, Kríženie, A/B alebo kliknutí v histórii sa úryvok zahrá sám. |
| ▶ Play | Zahrá úryvok aktuálneho zvuku (napr. po ručnej úprave gombíka). |
| ⟳ Loop + posuvník | Opakuje úryvok s pauzou 0 až 9 s (0 = hrá bez prestávky), aby si mohol krútiť gombíkmi a počúvať bez klikania. Zastaví ho ďalšie kliknutie alebo Stop. |
| Úryvok | Podľa typu (bas, lead, pluck = Melódia; pad, keys = Akordy; FX = Jedna nota), alebo pevne Melódia, Akordy, Jedna nota. |
| MIDI kanál | 1 = Synth 1, 2 = Synth 2 (podľa nastavenia CT). Musí sedieť so synthom, ktorý máš vybraný v Components. |

**Keyboard Octave:** CT ju používa pre svoje pady, ale noty z MIDI ignoruje (preto Launchkey hrá stále rovnako). Panel preto posunie úryvok o hodnotu Keyboard Octave, aby bas znel tak ako z padov.

## Otvoriť a uložiť .syx

**Otvoriť .syx** načíta patch zo súboru priamo do gombíkov editora a Components ho hneď pošle do CT. Nemusíš cez Synth → Upload. Načítajú sa všetky gombíky okrem makier a názvu patchu.

- Naraz môžeš vybrať viac súborov. Prvý sa načíta do editora, všetky sa pridajú do histórie ako „Otvorené · Názov“ a prepínaš medzi nimi klikom v histórii.
- Na otvorený zvuk funguje Mutuj, ★ aj Kríženie. Názov pôvodu sa prenesie ďalej, aj do názvu pri Uložiť .syx (napr. `Mut FilterBass #03`).

**Pri otvorení nastaviť delay/reverb projektu CT** (zaškrtnuté predvolene): patche z prevodníka MiniNova/UltraNova → CT majú v nevyužitých bajtoch uložené nastavenie delay a reverbu z originálu. CT má delay a reverb spoločný pre celý projekt, nie v patchi, preto ich panel po otvorení pošle do CT cez MIDI kanál 16 (typ, decay, damping reverbu; čas, sync, feedback, šírku delay) a nastaví send pre Synth 1 alebo 2 podľa MIDI kanála. Zmení sa tým nastavenie celého projektu, nielen tohto zvuku. Bežné Novation patche tieto údaje nemajú a nič sa nepošle.

- MIDI kanál 16 musí byť na CT nastavený ako projektový kanál (výrobné nastavenie).
- Údaje fungujú len pri otvorení cez panel. Ak patch nahráš cez Packs, Components ich pravdepodobne nezachová.
- Makro 1 (mod wheel z originálu) sa pri Otvoriť .syx nenačíta, lebo panel makrá nemení. Ak ho chceš, nahraj patch cez Packs.

**Prevodník MiniNova/UltraNova → CT** je samostatný projekt: [github.com/imarkone/mininova-to-circuit-tracks](https://github.com/imarkone/mininova-to-circuit-tracks). Stránku `web/index.html` otvoríš v prehliadači aj bez internetu, pretiahneš do nej .syx z MiniNova a stiahneš ZIP s CT patchmi a `report.csv` (známka A/B/C podľa toho, čo sa pri prevode stratilo).

**Uložiť .syx** prečíta aktuálny zvuk priamo z CT (SysEx dump Synth 1 alebo 2 podľa MIDI kanála) a stiahne ho ako súbor:

- Názov: `Rnd <typ> <intenzita> #<poradie>` (Mut pre Mutuj), napr. `Rnd bass 70 #05`. Rovnaký názov dostane aj patch v súbore.
- Súbor nahráš do Components cez Packs ako každý iný patch.
- Funguje len pre MIDI kanál 1 alebo 2 a pri pripojenej CT.

**JSON (debug):** ak je zaškrtnutý, k .syx sa uloží aj súbor .json s typom, intenzitou, zámkami, seedom, zoznamom donorových patchov a všetkými hodnotami. Slúži na analýzu a ladenie generátora.

Pri kontrole hlasitosti ulož .syx až keď stavový riadok ukáže výsledok („Hlasitosť vyrovnaná“ alebo „Hlasitosť OK“), aby obsahoval upravený zvuk.

## Nahrávanie WAV a kontrola hlasitosti

Zapoj výstup CT (L/R) do vstupov zvukovky. Gain nastav raz tak, aby najhlasnejší zvuk nepreskakoval do červeného, a potom ho už nemeň: cieľová hlasitosť platí len pre tento gain.

1. **Načítať vstupy** – povoľ mikrofón a vyber vstup zvukovky (napr. UMC404HD 1+2).
2. **● WAV** – nahrá úryvok aktuálneho zvuku aj s 1,5 s dozvukom a stiahne WAV.
3. **● Dávka .syx → WAV** – vyber viac .syx súborov. Každý sa pošle do CT, zahrá a nahrá. Medzi súbormi sa pošle „všetky noty vypnuté“ a počká sa, kým zvuk utichne. Na konci sa vráti pôvodný patch a stiahne sa jeden ZIP.

Prehliadač má pri nahrávaní vypnuté potlačenie šumu, ozveny aj automatické zosilnenie, aby boli úrovne porovnateľné. Nahráva sa stereo.

**analysis.csv v ZIP-e dávky:**

| Stĺpec | Význam |
| --- | --- |
| max_db | Najhlasnejších 50 ms (dBFS). Hlavné číslo pre hlasitosť. |
| dev_db | Odchýlka od cieľa (−21 dB). |
| peak_db, clipped | Špička a počet preťažených vzoriek. |
| silent | 1 = ticho (pod −40 dB). |
| lr_corr | 1 = mono, menej = stereo šírka. |
| centroid_hz | Jas zvuku. |

**Kontrola a vyrovnanie hlasitosti** (zaškrtni pri vybranom vstupe): po Random alebo Krížení sa úryvok zároveň nahrá a zmeria.

- Ticho (pod −40 dB) → nový Random, najviac 3-krát.
- Mimo cieľa −21 ±4 dB → zvuk sa nastaví na cieľ cez **Post FX Level** (posledné zosilnenie za efektmi, v dB) a mixer len na zvyšok. Po každej z najviac 2 korekcií sa znova zmeria.
- Stavový riadok ukáže napr. „Hlasitosť vyrovnaná: −9 → −20 dB“. Ak mixer aj Post FX sú na maxime, napíše „mixer už nemá rezervu“.

Cieľ −21 dB pochádza z nahrávok 18 továrenských patchov pri gaine autora (rozsah −30 až −12 dB). Ak máš iný gain, uprav `target_db` v `data/levels.csv`.

## Odporúčaný pracovný postup

1. V Components vyber synth (Synth 1 alebo 2) a v paneli nastav zodpovedajúci MIDI kanál.
2. Zapni **Po zmene zahrať úryvok** a pri zapojenej zvukovke aj **Kontrola a vyrovnanie hlasitosti**.
3. Vyber typ zvuku a intenzitu (začni okolo 50 až 70) a stláčaj **Random**, kým niečo zaujímavé nezaznie.
4. Dobré zvuky označ ★. Keď máš aspoň dva, skúšaj **🧬 Krížiť**.
5. Najlepší zvuk dolaď: **📷 Snapshot**, potom krúť gombíkmi pri zapnutom **⟳ Loop** a porovnávaj cez **A/B**. Skupinu, ktorá sedí, zamkni a Randomom hľadaj zvyšok.
6. Hotový zvuk ulož cez **Uložiť .syx**, alebo priamo v Components cez **Send to Circuit Tracks** do slotu.

## Úprava CSV súborov

Všetky texty a nastavenia sú v CSV súboroch v priečinku `data/`, nie v kóde. Upravíš ich v Exceli alebo v textovom editore (kódovanie UTF-8, oddeľovač čiarka), uložíš a v Extensions dáš Reload.

| Súbor | Čo obsahuje | Kedy ho meniť |
| --- | --- | --- |
| `lang.csv` | Všetky texty panela (stĺpce key, sk, en). | Chceš iný názov tlačidla alebo opraviť preklad. Stĺpec `key` nemeň. |
| `levels.csv` | Cieľ hlasitosti (`target_db` −21), rozpätie (`tolerance_db` 4), ticho (`silent_db` −40), max. špička (`peak_db` −1), pokusy (`retries` 3), korekcie (`corrections` 2), ticho medzi súbormi dávky (`tail_db` −60). | Zmenil si gain zvukovky alebo chceš prísnejšiu kontrolu. |
| `recipes.csv` | Pre každý typ zvuku: `jitter` (náhodná odchýlka), `wild` (divokosť), `phrase` (úryvok podľa typu). | Chceš divokejší alebo kľudnejší typ, alebo iný úryvok. |
| `phrases.csv` | Úryvky: čas (ms), MIDI nota, dĺžka (ms), velocity. | Vlastná melódia alebo akordy. |
| `corpus.csv` | 542 skutočných patchov, z ktorých Random skladá zvuky. | Riadok zmazať = patch sa už nepoužije. Nové patche treba dekódovať zo .syx. |

Pri cieľovej hlasitosti: ak zvýšiš gain zvukovky o 6 dB, zvýš aj `target_db` o 6 (napr. z −21 na −15).

## Riešenie problémov

| Problém | Príčina a riešenie |
| --- | --- |
| Panel sa nezobrazí | Otvor Synth editor (nie Packs) a obnov stránku F5. Skontroluj, že rozšírenie je v Extensions zapnuté. |
| V paneli je staré číslo verzie | Nahral sa starý priečinok. Nahraď súbory, daj Reload a obnov stránku. |
| Gombíky sa menia, ale CT nehrá nový zvuk | Components posiela zmeny len do synthu vybraného v Components. Vyber správny Synth 1/2. |
| Úryvok hrá iný synth | MIDI kanál v paneli nesedí: 1 = Synth 1, 2 = Synth 2. |
| „MIDI nie je dostupné“ alebo bez zvuku | Povoľ MIDI a SysEx pre stránku (ikona zámku v adresnom riadku). Zatvor iné programy, ktoré držia MIDI port CT. |
| „Vstup zvukovky nie je dostupný“ | Povoľ mikrofón pre stránku, klikni Načítať vstupy a vyber vstup znova. |
| Uložiť .syx: „CT neodpovedala“ | CT nie je pripojená, alebo je MIDI kanál iný ako 1/2. |
| Zvuk je ticho alebo príliš hlasný | Zapni Kontrolu a vyrovnanie hlasitosti. Ak panel napíše „mixer už nemá rezervu“, zvuk je tichý sám od seba: daj ďalší Random. |
| Náhľad na Packs: „Restoration could not be verified“ | Na CT znova vyber svoj pôvodný patch. |

Zdroj MIDI a SysEx príkazov: [Circuit Tracks Programmer's Reference Guide V3](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/circuit_tracks_programmer_s_reference_guide_v3.pdf). Rozšírenie je komunitný projekt nezávislý od Novation a Focusrite.
