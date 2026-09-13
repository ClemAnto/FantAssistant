# Pre-registrazione: la board dell'ULTIMO PERIODO alla revisione 65 (13/09/2026)

Il FOGLIO e' quello delle **14:13** del 13/09 (`sheet_revision` 65, lo stesso che l'app sta
mostrando); questa tabella e' stata estratta alle **15:10**. Stessi 23 club e stesso metro delle
due prese precedenti — [12/09 22:53, rev 63](preregistrazione-board-breve-2026-09-12.md) e
[13/09 00:45, rev 64](preregistrazione-board-breve-2026-09-13.md) — che **restano valide per il
codice che descrivevano**.

**Perche' una terza.** Dopo la presa delle 00:45 sono stati adottati `RECENT_DECAY` = 0,5 («di
piu'» e' PESATO e non contato) e il veto della staffetta che sceglie chi gioca e non chi e' un
rivale. Quel blocco cambia **12 uomini in 7 dei 23 club**, e la segnalazione dell'operatore sul
Lecce («hai messo Kaba titolare ma non ha nessun senso») e' esattamente uno di quei posti: la
presa delle 00:45 lo dava a **Kaba**, questa lo da' a **Ilic** e sposta Coulibaly in trequarti.
Scorare domani solo una delle tre giudicherebbe una previsione che nessuno sta piu' spedendo.

**LIMITE, e va detto prima dei numeri.** Le due prese precedenti potevano dichiarare che nessuna
delle 23 partite era cominciata; questa NO. `fixtures` porta la data e non l'ora (verificato: 18
partite datate 13/09, tutte `played = 0` alla lettura delle 14:13), quindi alle 15:10 non sappiamo
quali abbiano gia' preso il via. **Al momento dello scoring si scarta ogni club la cui partita e'
cominciata prima delle 15:10**: per quelli questa presa non e' un pronostico e le altre due si'.

Cosa cambia rispetto alla presa delle 00:45 — sono tutti di Serie A, e nessuno dei dodici club
euro si muove:

| club | fuori | dentro |
|---|---|---|
| Bologna | Helland | Theate |
| Inter | Calhanoglu | Zielinski |
| Lecce | Kaba | Ilic |
| Monza | Foe Ondoa, Mout, Colpani | Folorunsho, Akinsanmiro, Forson O. |
| Parma | Valenti, Lontani | Diego Carlos, Romero D. |
| Roma | Mora | Soulè |
| Torino | Mascardi, Braganca, Simeone | Perri, Mandragora, Adams C. |

| club | lega | quando | avversario | modulo | undici previsto |
|---|---|---|---|---|---|
| Bayern Monaco | bundesliga | 2026-09-13 fuori | elversberg | `4-2-3-1` | Neuer, Laimer, Upamecano, Tah, Davies A., Kimmich, Pavlovic A., Karl, Brown N., Luis Diaz, Kane |
| Lipsia | bundesliga | 2026-09-13 casa | hamburger | `4-3-3` | Vandevoordt, Baku, Orban, Lukeba, Raum, El Aynaoui, Seiwald, Banzuzi, Gruda, Nkunku, Nusa |
| Atletico Madrid | la_liga | 2026-09-13 fuori | real sociedad | `4-4-2` | Oblak, Llorente M., Pubill, Hancko, Grimaldo, Simeone G., Barrios, Hjulmand, Lookman, Lee K., Baena |
| Barcellona | la_liga | 2026-09-13 fuori | levante | `4-3-3` | Garcia J., Garcia E., Cubarsì, Martin G., Espart, Lopez F., Bernal, Pedri, Lamine Yamal, Raphinha, Gordon |
| Betis | la_liga | 2026-09-14 fuori | villarreal | `4-2-3-1` | Valles, Bellerin, Llorente D., Natan, Garcia F., Bernal F., Roca, Antony, Isco, Riquelme, Hernandez C. |
| Villarreal | la_liga | 2026-09-14 casa | real betis | `4-4-2` | Luiz Junior, Mourino, Foyth, Veiga R., Romero C., Pepe N., Comesana, Gueye P., Moleiro, Moreno G., Mikautadze |
| Paris Saint-Germain | ligue_1 | 2026-09-13 fuori | stade brestois | `4-3-3` | Safonov, Hakimi, Marquinhos, Pacho, Zaire-Emery, Vitinha, Joao Neves, Ruiz, Akliouche, Torres F., Douè D. |
| Brighton | premier_league | 2026-09-13 fuori | coventry city | `4-2-3-1` | Verbruggen, Kadioglu, Vuskovic, Dunk, Boscagli, Gross, Ayari, Gomez D., Yalcouyè, De Cuyper, Kostoulas |
| Manchester City | premier_league | 2026-09-13 fuori | manchester united | `4-2-3-1` | Donnarumma G., Khusanov, Ruben Dias, Guehi, Gvardiol, O'Reilly, Anderson E., Foden, Cherki, Semenyo, Haaland |
| Manchester United | premier_league | 2026-09-13 casa | manchester city | `4-2-3-1` | Lammens, Dalot, Maguire, Martinez Lis., Shaw, Tielemans, Mainoo, Mbeumo, Bruno Fernandes, Rashford, Cunha |
| Newcastle | premier_league | 2026-09-14 fuori | leeds united | `4-2-3-1` | Hornicek, Dedic, Thiaw, Botman, Hall, Nico Gonzalez, Miley, Elanga, Willock, Barnes, Wissa |
| Bologna | serie_a | 2026-09-13 fuori | napoli | `4-2-3-1` | Skorupski, Holm, Heggem, Theate, Miranda J., Ferguson, Pobega, Bernardeschi, Odgaard, Cambiaghi, Piccoli |
| Como | serie_a | 2026-09-14 casa | parma | `4-2-3-1` | Butez, Couto, Ramon, Chalobah T., Valle, Perrone, Da Cunha, Diao, Paz N., Baturina, Douvikas |
| Inter | serie_a | 2026-09-14 casa | udinese | `3-5-2` | Martinez Jo., Bisseck, Akanji, Bastoni, Diouf, Barella, Sucic P., Zielinski, Dimarco, Esposito F.P., Martinez L. |
| Juventus | serie_a | 2026-09-13 fuori | sassuolo | `4-2-3-1` | Vicario, Kalulu, Bremer, Lucumì, Celik, Koopmeiners, Douglas Luiz, Conceicao, Gonzalez N., Alajbegovic, Kolo Muani |
| Lecce | serie_a | 2026-09-13 casa | monza | `4-2-3-1` | Falcone, Veiga D., Gaspar K., Tiago Gabriel, Gallo, Ilic, Ngom, Pierotti, Coulibaly L., Monteiro J., Stulic |
| Monza | serie_a | 2026-09-13 fuori | lecce | `3-4-2-1` | Thiam, Kouadio, Lucchesi, Carboni A., Birindelli, Folorunsho, Akinsanmiro, Mangas, Forson O., Robinson J., Mota |
| Napoli | serie_a | 2026-09-13 casa | bologna | `4-3-3` | Milinkovic-Savic V., Di Lorenzo, Rrahmani, Marin R., Spinazzola, De Bruyne, Lobotka, Vergara, Politano, Hojlund, Lang |
| Parma | serie_a | 2026-09-14 fuori | como | `3-4-2-1` | Corvi, Delprato, Diego Carlos, Troilo, Britschgi, Ordonez C., Keita M., Valeri, Fabbian, Tourè E., Romero D. |
| Roma | serie_a | 2026-09-14 fuori | torino | `3-4-2-1` | Svilar, Mancini, N'Dicka, Hermoso, Lulli, Cristante, De Roon, Wesley, Dybala, Soulè, Malen |
| Sassuolo | serie_a | 2026-09-13 casa | juventus | `4-3-3` | Muric, Cinquegrano, Idzes, Leysen F., Doig, Adzic, Matic, Lipani, Berardi, Bowie, Laurientè |
| Torino | serie_a | 2026-09-14 casa | roma | `3-1-4-2` | Perri, Comert, Ismajli, Comuzzo, Mandragora, Fortini, Gineitis, Fitz-Jim, Cacciamani, Adams C., Vlasic |
| Udinese | serie_a | 2026-09-14 fuori | inter | `3-4-2-1` | Okoye, Abankwah, Bertola, Ebosse, Vojvoda, Karlstrom, Miller L., Kamara H., Unai Gomez, Ekkelenkamp, Davis K. |

## Come si scora

Per club: quanti degli undici previsti sono nella distinta vera (su 11), e se il modulo coincide.
Il null e' l'undici che ha cominciato l'ULTIMA partita di quel club, che si legge dallo stesso
livello per-partita — lo stesso delle altre due prese, quindi le tre tabelle sono appaiate e si
confrontano fra loro oltre che col fatto. Un numero senza il suo null non e' interpretabile.

Le tre prese differiscono SOLO per il codice: il foglio del 12/09 sera e quello del 13/09 sono
due giorni di dati diversi, quindi il confronto fra rev 63 e rev 64/65 muove due variabili; quello
fra **rev 64 e rev 65 ne muove una sola**, perche' leggono lo stesso giorno di calcio.
