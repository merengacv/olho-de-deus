// Portais oficiais de câmeras que não têm lista aberta (API). Entram no mapa como
// um ponto na cidade que abre o portal na fonte. A lista é mantida à mão.
// Campos: [nome, cidade/região, código do país, lat, lng, endereço, órgão]
const PORTAIS = [
  ["Câmeras CET (trânsito)", "São Paulo, SP", "BR", -23.5505, -46.6333, "https://www.cetsp.com.br/consultas/cameras-cet.aspx", "CET — Companhia de Engenharia de Tráfego"],
  ["Câmeras online das rodovias (DER-SP)", "Rodovias de São Paulo", "BR", -22.9, -47.06, "https://dersp.der.sp.gov.br/WebSite/Servicos/ServicosOnline/CamerasOnlineMapa.aspx", "DER-SP"],
  ["Centro de Operações Rio (COR)", "Rio de Janeiro, RJ", "BR", -22.9068, -43.1729, "https://cor.rio/", "Prefeitura do Rio de Janeiro"],
  ["Trânsito ao vivo (CTTU)", "Recife, PE", "BR", -8.0476, -34.877, "https://transito-recife.serttel.com.br/", "CTTU — Prefeitura do Recife"],
  ["Central de Monitoramento de Imagens", "Jaú, SP", "BR", -22.2936, -48.5592, "https://jaucameras.com.br/", "Prefeitura de Jaú"],
];

export default [{
  id: "portais", name: "Portais oficiais de câmeras", org: "vários órgãos públicos", country: "", type: "portal",
  home: "", attr: "cada portal pertence ao respectivo órgão", lic: "links para os portais oficiais",
  run: async () => PORTAIS.map(([name, where, cc, lat, lng, page, org], i) => ({ id: "p" + i, name: `${name} — ${org}`, where, cc, lat, lng, page })),
}];
