import { generarParClaves } from '../src/license/token-licencia.js';

// Genera el par Ed25519 de licencias. La privada va al .env del backend (LICENSE_SIGNING_KEY_PEM);
// la pública se incrusta en los VST al compilarlos.
const { privada, publica } = generarParClaves();
process.stdout.write(`LICENSE_SIGNING_KEY_PEM="${privada.replace(/\n/g, '\\n')}"\n\n# Clave pública (para los VST):\n${publica}`);
