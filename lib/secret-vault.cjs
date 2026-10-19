const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function atomic(filename, value) {
  fs.mkdirSync(path.dirname(filename), {recursive:true});
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, value, {mode:0o600}); fs.renameSync(temporary, filename); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}

// Secrets never cross the preload bridge or enter workspace/synchronization files.
class SecretVault {
  constructor({directory, storage}) {
    this.storage = storage;
    this.filename = path.join(directory, 'integration-secrets.bin');
    this.values = {};
    if (fs.existsSync(this.filename)) {
      this.available();
      try { this.values = JSON.parse(storage.decryptString(fs.readFileSync(this.filename))); }
      catch { throw new Error('Não foi possível abrir as credenciais das integrações. O arquivo original foi preservado.'); }
    }
  }
  available() {
    if (!this.storage?.isEncryptionAvailable()) throw new Error('O armazenamento seguro não está disponível. As credenciais não serão gravadas em texto.');
  }
  key(profileId, connectionId) { return crypto.createHash('sha256').update(JSON.stringify([profileId, connectionId])).digest('hex'); }
  get(profileId, connectionId) { return structuredClone(this.values[this.key(profileId, connectionId)] || {}); }
  set(profileId, connectionId, patch) {
    this.available();
    const key = this.key(profileId, connectionId), previous = this.values[key];
    this.values[key] = {...previous, ...structuredClone(patch)};
    try { atomic(this.filename, this.storage.encryptString(JSON.stringify(this.values))); }
    catch(error) { if (previous === undefined) delete this.values[key]; else this.values[key] = previous; throw error; }
  }
  delete(profileId, connectionId) {
    this.available();
    const key = this.key(profileId, connectionId), previous = this.values[key]; delete this.values[key];
    try { atomic(this.filename, this.storage.encryptString(JSON.stringify(this.values))); }
    catch(error) { this.values[key] = previous; throw error; }
  }
}
module.exports = {SecretVault, atomic};
