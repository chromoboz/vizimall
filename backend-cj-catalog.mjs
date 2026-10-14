export const launchDestinations = ['DE','FR','NL','PL','ES','PT','IT','GR'];
export function mainCatalogContext(product) {
  if (String(product?.vendor||'').toLowerCase() !== 'cjdropshipping' || product.status === 'ARCHIVED') return null;
  const text = `${product.productType||''} ${product.title||''}`.toLowerCase();
  const category = /massage|beauty|skin|hair/.test(text) ? 'beauty' : /lamp|lighting|home|kitchen/.test(text) ? 'home' : /pet|cat|dog/.test(text) ? 'pets' : /toy|kids|child/.test(text) ? 'kids' : /car |auto/.test(text) ? 'auto' : /clothing|fashion|dress/.test(text) ? 'fashion' : 'tech';
  // Dispatch is validated against CJ stock, independently of the customer's country.
  return {browsing:'CN', category};
}
