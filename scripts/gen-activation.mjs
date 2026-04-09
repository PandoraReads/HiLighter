/**
 * English Made Easy - Activation Code Generator
 * 
 * Usage: node scripts/gen-activation.mjs <email>
 */

import crypto from 'node:crypto';

// MUST match ACTIVATION_SALT in src/utils/activation-service.ts
const ACTIVATION_SALT = 'EME-LEGACY-SECRET-2024';

function generateCode(email) {
    const input = (email.toLowerCase().trim() + ACTIVATION_SALT);
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return hash.slice(0, 10).toUpperCase();
}

const email = process.argv[2];

if (!email) {
    console.error('Error: Please provide an email address.');
    console.log('Usage: node scripts/gen-activation.mjs example@email.com');
    process.exit(1);
}

const code = generateCode(email);

console.log('========================================');
console.log('   English Made Easy - Activation Code  ');
console.log('========================================');
console.log(`Email: ${email}`);
console.log(`Code:  ${code}`);
console.log('========================================');
console.log('Instruction: Provide both Email and Code to the user.');
