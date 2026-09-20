// A separate Git branch keeps a durable stop after a booking attempt, even if a
// runner dies before its response arrives. File creation uses GitHub's atomic
// create semantics: two runners cannot both claim the same intent.
export class BookingJournal {
  constructor({ token, repository, key, fetchImpl = fetch }) {
    if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[\w-]+$/.test(key)) {
      throw new Error('Missing or invalid booking journal configuration');
    }
    this.fetch = fetchImpl;
    this.root = `https://api.github.com/repos/${repository}`;
    this.headers = {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'};
    this.branch = 'resy-booking-state';
    this.path = `booking-state/${key}.json`;
  }
  async request(path, body, method = 'POST') {
    const response = await this.fetch(`${this.root}${path}`, {
      headers:this.headers, method:body ? method : 'GET', body:body ? JSON.stringify(body) : undefined,
      signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const error = new Error(`Booking journal HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  async read() {
    try {
      const file = await this.request(`/contents/${this.path}?ref=${this.branch}`);
      this.sha = file.sha;
      return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  async claim(intent) {
    try {
      await this.request(`/git/ref/heads/${this.branch}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      const main = await this.request('/git/ref/heads/main');
      try {
        await this.request('/git/refs', {ref:`refs/heads/${this.branch}`,sha:main.object.sha});
      } catch (createError) {
        if (createError.status !== 422) throw createError;
      }
    }
    // Deliberately omit SHA so an existing intent cannot be overwritten.
    const file = await this.request(`/contents/${this.path}`, {
      branch:this.branch, message:'Record reservation attempt before contacting Resy',
      content:Buffer.from(JSON.stringify({...intent,status:'pending'},null,2)).toString('base64'),
    }, 'PUT');
    this.sha = file.content.sha;
  }
  async finish(status) {
    const file = await this.request(`/contents/${this.path}`, {
      branch:this.branch, sha:this.sha, message:`Record reservation result: ${status}`,
      content:Buffer.from(JSON.stringify({status,updatedAt:new Date().toISOString()},null,2)).toString('base64'),
    }, 'PUT');
    this.sha = file.content.sha;
  }
}
