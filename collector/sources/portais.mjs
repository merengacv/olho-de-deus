// Portais oficiais de câmeras que não têm lista aberta (API). Entram no mapa como
// um ponto na cidade que abre o portal na fonte. A lista é mantida à mão.
// Campos: [nome, cidade/região, código do país, lat, lng, endereço, órgão]
const PORTAIS = [
  ["Câmeras CET (trânsito)", "São Paulo, SP", "BR", -23.5505, -46.6333, "https://camerascet.prefeitura.sp.gov.br/", "CET — Companhia de Engenharia de Tráfego"],
  ["Câmeras ao vivo da Transalvador (trânsito)", "Salvador, BA", "BR", -12.9777, -38.5016, "https://cameras-transalvador.salvador.ba.gov.br/", "Transalvador — Prefeitura de Salvador"],
  ["Central de Monitoramento de Imagens", "Jaú, SP", "BR", -22.2936, -48.5592, "https://jaucameras.com.br/", "Prefeitura de Jaú"],
];

export default [{
  id: "portais", name: "Portais oficiais de câmeras", org: "vários órgãos públicos", country: "", type: "portal",
  home: "", attr: "cada portal pertence ao respectivo órgão", lic: "links para os portais oficiais",
  run: async () => PORTAIS.map(([name, where, cc, lat, lng, page, org], i) => ({ id: "p" + i, name: `${name} — ${org}`, where, cc, lat, lng, page })),
}];
