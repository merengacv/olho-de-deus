# Olho de Deus

Globo 3D de satélite com câmeras públicas do mundo inteiro e o que está acontecendo agora:
sismos, incêndios, tempestades, vulcões, a Estação Espacial, clima em qualquer ponto,
notícias geolocalizadas e voos. Tudo com dados abertos, direto no navegador.

**Site:** https://merengacv.github.io/olho-de-deus/

## O que tem

**Mapa de satélite.** Fotos de satélite e aéreas do planeta inteiro (Esri World Imagery),
com nomes de países, cidades e bairros por cima (botão *Rótulos*) e ruas (botão *Ruas*).
Dá para aproximar até cerca de 1 km do chão. Outros fundos: *Sem nuvens* (mosaico
Sentinel-2 de 2024), *Ontem* (o planeta fotografado ontem pela NASA, com as nuvens do dia)
e *Tático* (o mapa escuro antigo). De longe aparece a noite, com as luzes das cidades;
ao aproximar, a noite some para mostrar a foto do lugar.

**Câmeras públicas.** Um banco montado todo dia por um robô (veja abaixo) com mais de
100 mil câmeras de quase 100 países: trânsito, cidades, praias, montanhas, rios, portos,
aeroportos, vulcões, ciência. Cada cor é um tipo. Clique num ponto para ver a câmera:

- imagem atual (renova a cada minuto), vídeo ao vivo, player ou clipe, conforme a fonte;
- quando o dono não permite embutir, o botão abre a câmera no site oficial;
- "Câmeras por perto" lista as vizinhas (também aparece ao buscar uma cidade).

A aba **Câmeras** mostra as câmeras perto do centro da tela e a lista por país.
Na camada dá para filtrar por tipo ou ver *Só vídeo*.

**Webcams Windy (ao vivo).** As webcams do Windy mais vistas na região da tela,
consultadas na hora pela API oficial, com a imagem levando à página de cada uma no Windy.

**Sismos** (USGS), **eventos naturais** (NASA EONET), **ISS** (órbita real e passagens
visíveis), **clima** em qualquer ponto clicado (Open-Meteo), **notícias** (GDELT) e
**voos** (OpenSky) continuam como antes.

Atalhos: `/` buscar, `Esc` fechar, `M` trocar o mapa, `R` atualizar, `G` girar, `I` ISS.

## O robô diário

O GitHub Actions roda `collector/collect.mjs` todo dia às 04:23 (Brasília):

1. Lê cada fonte oficial direto da origem (órgãos de trânsito dos EUA, Canadá, Europa,
   Ásia, Oceania e África do Sul; OpenStreetMap; Wikidata; portais oficiais).
2. Se uma fonte estiver fora do ar, usa a última coleta boa dela.
3. Completa com o catálogo aberto [Argus](https://github.com/GoSlowPoke168/Argus) (MIT),
   filtrado (sem Windy, sem redes comerciais que não autorizam embutir, sem endereços
   com senha ou token), e tira duplicatas.
4. Publica o site no GitHub Pages e tira fotos do site publicado.

Para rodar na hora: aba **Actions** → *Coletar câmeras e publicar* → *Run workflow*.

Onde ver o resultado:
- ramo `relatorio`: `report.json` com cada fonte (quantas câmeras, erros);
- ramo `telas`: fotos do site publicado e `conferir.json` (erros do navegador).

## Configuração (uma vez)

1. **Pages:** Settings → Pages → Source: **GitHub Actions**.
2. **Windy:** crie a chave em https://api.windy.com/keys e guarde em
   Settings → Secrets and variables → Actions → `WINDY_API_KEY`.
   Os termos do Windy não deixam guardar os dados deles, então o site consulta a API
   na hora, pelo navegador: a chave vai no código do site. Por isso, na conta do
   Windy, **autorize só o domínio `merengacv.github.io`** nessa chave.

## Regras (de propósito)

- Só câmeras publicadas por órgãos públicos ou redes abertas que permitem exibição.
  Sites como o Insecam (câmeras privadas expostas por senha padrão) ficam de fora.
- Nada de reconhecimento facial.
- Cada imagem continua sendo de quem a publica; o site mostra a fonte e a licença.

## Estrutura

```
site/                 o site publicado (index.html, sw.js, vendor/, img/)
collector/collect.mjs coletor diário; collector/sources/ = uma fonte por arquivo
collector/probe.mjs   sonda de APIs (ramo sondagem)
tools/conferir.mjs    fotos do site publicado (ramo telas)
tools/farejar.mjs     farejador de portais em navegador real (ramo farejo)
```

## Créditos

Mapa: Esri World Imagery (Esri, Vantor, Earthstar Geographics e comunidade GIS);
rótulos e ruas: Esri, HERE, Garmin, © colaboradores do OpenStreetMap; Sentinel-2
cloudless 2024 © EOX IT Services (CC BY-NC-SA 4.0); NASA GIBS, Blue Marble e Black Marble;
Natural Earth. Dados: USGS, NASA EONET, wheretheiss.at, CelesTrak, Open-Meteo (CC BY 4.0),
GDELT, OpenSky, OpenStreetMap/Nominatim (ODbL), Windy.com e as fontes de câmeras listadas
na aba Fontes do site. Bibliotecas: globe.gl e three.js (MIT), satellite.js (MIT),
hls.js (Apache 2.0).
