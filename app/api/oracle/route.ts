import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const file = path.resolve(process.cwd(), 'packages', 'onchain-oracle', 'data', 'summary.json');
    if (!fs.existsSync(file)) {
      return NextResponse.json({ error: 'summary not generated' }, { status: 404 });
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Optionally include latest tx proof if present in the same folder
    const proofFile = path.resolve(process.cwd(), 'packages', 'onchain-oracle', 'data', 'last_tx.json');
    let proof = null;
    if (fs.existsSync(proofFile)) {
      proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
    }
    return NextResponse.json({ summary: data, proof });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
