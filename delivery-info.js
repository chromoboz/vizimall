(function(root) {
  'use strict';
  const countries = {DE:'Germany',NL:'Netherlands',FR:'France',GR:'Greece',IT:'Italy',PL:'Poland',PT:'Portugal',ES:'Spain'};
  const missing = () => ({method:null,processing:null,estimate:null,cost:null,note:'Delivery details for this destination have not been provided. Final availability and charges are confirmed with your address at checkout.'});
  const text = value => typeof value === 'string' && value.length <= 500 ? value.trim() || null : null;
  function route(product, country, variantId, now = Date.now()) {
    const result = missing();
    if (!countries[country]) return result;
    // Public customer-facing fields only. No supplier credentials or private costs.
    try {
      const data = product.delivery?.type === 'json' ? JSON.parse(product.delivery.value) : null;
      const entry = data?.version === 1 ? data.destinations?.[country] : null;
      const specific = entry?.variants?.[variantId];
      const record = specific || (entry?.appliesToAllVariants === true ? entry : null);
      if (record?.verified === true && record.available === true && text(record.source)
          && Number.isFinite(Date.parse(record.checkedAt)) && Date.parse(record.checkedAt) <= now
          && Date.parse(record.expiresAt) > now) {
        return {method:text(record.shippingMethod),processing:text(record.processingTime),estimate:text(record.estimatedDelivery),cost:text(record.customerShippingCost),note:'Source: '+record.source+'. Checked '+record.checkedAt+'. Estimated delivery is not guaranteed; final charges are confirmed at checkout.'};
      }
    } catch {}
    // Preserve existing explicit destination evidence without turning tags into estimates.
    const description = String(product.description || '').replace(/\s+/g,' ');
    const match = description.match(/Estimated delivery:\s*([^.;]+)(?:[.;]|$)/i);
    const name = countries[country];
    if (!match || !new RegExp('\\bto (?:the )?'+name+'\\b','i').test(match[1])) return result;
    result.estimate = match[1].trim();
    const processing = description.match(/Processing is\s+([^;.]+)[;.]/i);
    if (processing) result.processing = processing[1].trim();
    const cost = description.match(new RegExp('\\b'+name+' shipping:\\s*([^.;]+(?:\\.\\d{2})?[^.;]*)[.;]','i'));
    if (cost) result.cost = 'Supplier-reported: '+cost[1].trim();
    result.note = 'From the current product description; not a live shipping quote. Supplier averages and preparation ranges are estimates, not guarantees. Final shipping cost is confirmed at checkout.';
    return result;
  }
  root.VizimallDelivery = Object.freeze({route});
})(typeof window === 'undefined' ? globalThis : window);
