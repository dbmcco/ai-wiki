import 'dotenv/config';
import { closeDb, withTransaction } from './client.js';

async function seed() {
  console.log('Seeding database...\n');

  await withTransaction(async (client) => {
    // Create personal tenant
    const personalResult = await client.query<{ id: string }>(`
      INSERT INTO tenants (slug, name, settings)
      VALUES ('personal', 'Personal', '{"defaultModel": "claude-sonnet-4-20250514"}')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    const personalId = personalResult.rows[0]?.id;
    console.log(`Created tenant: personal (${personalId})`);

    // Create personal namespaces
    const personalNamespaces = [
      { slug: 'recipes', name: 'Recipes', description: 'Food and cooking' },
      { slug: 'travel', name: 'Travel', description: 'Places to visit' },
      { slug: 'learnings', name: 'Learnings', description: 'Life lessons and insights' },
    ];

    for (const ns of personalNamespaces) {
      await client.query(`
        INSERT INTO namespaces (tenant_id, slug, name, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
      `, [personalId, ns.slug, ns.name, ns.description]);
      console.log(`  Created namespace: ${ns.slug}`);
    }

    // Create dev-learnings tenant
    const devResult = await client.query<{ id: string }>(`
      INSERT INTO tenants (slug, name, settings)
      VALUES ('dev-learnings', 'Development Learnings', '{"defaultModel": "claude-sonnet-4-20250514", "autoLinkThreshold": 0.75}')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    const devId = devResult.rows[0]?.id;
    console.log(`Created tenant: dev-learnings (${devId})`);

    // Create dev namespaces
    const devNamespaces = [
      { slug: 'architecture', name: 'Architecture', description: 'Architectural patterns and decisions' },
      { slug: 'debugging', name: 'Debugging', description: 'Debugging insights and solutions' },
      { slug: 'patterns', name: 'Patterns', description: 'Code patterns and best practices' },
      { slug: 'tools', name: 'Tools', description: 'Development tools and workflows' },
    ];

    for (const ns of devNamespaces) {
      await client.query(`
        INSERT INTO namespaces (tenant_id, slug, name, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
      `, [devId, ns.slug, ns.name, ns.description]);
      console.log(`  Created namespace: ${ns.slug}`);
    }
  });

  console.log('\nSeeding complete.');
}

async function main() {
  try {
    await seed();
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
