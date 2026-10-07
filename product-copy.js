(function(root){
  'use strict';
  // Reviewed display copy for this exact supplier title. Published Shopify translations take precedence.
  const source='20W Power Bank With Magnetic Closure, 10000mAh, Portable, Wireless, Fast Charging, MagSafe Compatible For IPhone 15 Pro Max And 16 Pro';
  const titles={DE:'Magnetische Powerbank · 10.000 mAh · 20 W',GR:'Μαγνητικό power bank · 10.000 mAh · 20 W',FR:'Batterie externe magnétique · 10 000 mAh · 20 W',IT:'Power bank magnetico · 10.000 mAh · 20 W',ES:'Batería externa magnética · 10.000 mAh · 20 W',NL:'Magnetische powerbank · 10.000 mAh · 20 W',PL:'Magnetyczny powerbank · 10 000 mAh · 20 W',PT:'Power bank magnético · 10.000 mAh · 20 W'};
  const summaries={DE:'10.000 mAh Kapazität, kabelloses Laden und bis zu 20 W Ladeleistung. Laut Anbieter mit MagSafe für iPhone 15 Pro Max und 16 Pro kompatibel.',GR:'Χωρητικότητα 10.000 mAh, ασύρματη φόρτιση και ισχύς έως 20 W. Σύμφωνα με τον προμηθευτή, συμβατό με MagSafe για iPhone 15 Pro Max και 16 Pro.',FR:'Capacité de 10 000 mAh, charge sans fil et puissance jusqu’à 20 W. Selon le fournisseur, compatible MagSafe pour iPhone 15 Pro Max et 16 Pro.',IT:'Capacità di 10.000 mAh, ricarica wireless e potenza fino a 20 W. Secondo il fornitore, compatibile con MagSafe per iPhone 15 Pro Max e 16 Pro.',ES:'Capacidad de 10.000 mAh, carga inalámbrica y potencia de hasta 20 W. Según el proveedor, compatible con MagSafe para iPhone 15 Pro Max y 16 Pro.',NL:'Capaciteit van 10.000 mAh, draadloos opladen en maximaal 20 W laadvermogen. Volgens de leverancier geschikt voor MagSafe voor iPhone 15 Pro Max en 16 Pro.',PL:'Pojemność 10 000 mAh, ładowanie bezprzewodowe i moc do 20 W. Według dostawcy zgodny z MagSafe dla iPhone 15 Pro Max i 16 Pro.',PT:'Capacidade de 10.000 mAh, carregamento sem fios e potência até 20 W. Segundo o fornecedor, compatível com MagSafe para iPhone 15 Pro Max e 16 Pro.'};
  function apply(item,country){
    if(item.id==='gid://shopify/Product/16123378008398' && (item.title===source || item.title===titles[country])) {
      item.title=titles[country]||item.title; item.summary=summaries[country];
      // This product currently has only this one German supplier sentence as its description.
      // Do not replace a later, expanded or independently translated description.
      if(item.description?.trim()==='20W Powerbank mit Magnetverschluss, 10000mAh, tragbar, kabellos, Schnellladefunktion, MagSafe-kompatibel für iPhone 15 Pro Max und 16 Pro') {
        item.description=item.summary; item.descriptionHtml='<p>'+item.summary+'</p>';
      }
    }
    return item;
  }
  function search(value){return String(value).replace(/\b(powerbank|batterie externe|batería externa)\b/gi,'Power Bank');}
  root.VizimallProductCopy=Object.freeze({apply,search});
})(typeof window==='undefined'?globalThis:window);
