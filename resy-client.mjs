import { cleanApiKey, cleanAuthToken } from './check-resy.mjs';

export class ResyClient {
  constructor({ apiKey, authToken, fetchImpl = fetch }) {
    if (!cleanApiKey(apiKey) || !cleanAuthToken(authToken)) throw new Error('Missing Resy credentials');
    this.fetch = fetchImpl;
    this.headers = {
      Authorization: `ResyAPI api_key="${cleanApiKey(apiKey)}"`,
      'x-resy-auth-token': cleanAuthToken(authToken),
      'x-resy-universal-auth': cleanAuthToken(authToken),
      Origin: 'https://resy.com', Referer: 'https://resy.com/',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    };
  }

  async request(path, body, form = false) {
    // No automatic retries: a timed-out mutation may already have succeeded.
    let response;
    try {
      response = await this.fetch(`https://api.resy.com${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { ...this.headers, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: body ? (form ? new URLSearchParams(body) : JSON.stringify(body)) : undefined,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const error = new Error(`Resy ${path.split('?')[0]} returned HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      // Never include remote response bodies, URLs containing tokens, or fetch causes.
      if (error.status) throw error;
      throw new Error(`Resy ${path.split('?')[0]} response unavailable; verify account before retrying`);
    }
  }

  async find(venueId, date, partySize) {
    const query = new URLSearchParams({lat:'0',long:'0',day:date,party_size:String(partySize),venue_id:String(venueId)});
    const data = await this.request(`/4/find?${query}`);
    if (!Array.isArray(data?.results?.venues)) throw new Error('Unknown Resy availability response');
    return data.results.venues.flatMap(v => {
      if (!Array.isArray(v.slots)) throw new Error('Unknown Resy slots response');
      if (Number(v.venue?.id?.resy) !== Number(venueId)) throw new Error('Resy returned an unexpected venue');
      return v.slots;
    });
  }

  details(slot, date, partySize) {
    if (typeof slot?.config?.token !== 'string') throw new Error('Missing slot configuration');
    return this.request('/3/details', {config_id:slot.config.token,day:date,party_size:String(partySize)});
  }

  async upcoming() {
    const result = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const data = await this.request(`/3/user/reservations?type=upcoming&limit=100&offset=${offset}`);
      if (!Array.isArray(data?.reservations)) throw new Error('Unknown Resy reservations response');
      result.push(...data.reservations);
      if (data.reservations.length < 100) return result;
    }
    throw new Error('Unable to inspect all upcoming reservations');
  }

  book(token, paymentId) {
    if (typeof token !== 'string' || !token) throw new Error('Missing book token');
    const body = {book_token:token};
    if (paymentId != null) body.struct_payment_method = JSON.stringify({id:paymentId});
    return this.request('/3/book', body, true);
  }

  cancel(token) {
    if (typeof token !== 'string' || !token) throw new Error('Missing cancellation token');
    return this.request('/3/cancel', {resy_token:token}, true);
  }
}
