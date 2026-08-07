import { createFuckClawRuntime } from '@fuckclaw/cli';
import { ManifestParser } from '@fuckclaw/skills';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

class Milestone6MockLLMProvider {
  name = 'm6-mock';
  async generate(request) {
    const prompt = request.messages[0]?.content || '';
    if (prompt.includes('service health check') || prompt.includes('deployment report')) {
      return {
        content: JSON.stringify({
          status: 'healthy',
          checksPassed: 4,
          summary: 'All microservice dependencies verified and operational in staging.',
        }),
        provider: this.name,
        model: 'mock-v1',
        usage: { promptTokens: 35, completionTokens: 45, totalTokens: 80 },
        costUsd: 0.00078,
      };
    }

    return {
      content: 'OK: Operation verified.',
      provider: this.name,
      model: 'mock-v1',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.00018,
    };
  }
}

async function runMilestone6Demo() {
  console.log('=== FuckClaw Milestone 6: Structural Knowledge & Skills Demonstration ===\n');

  const demoDir = path.join(os.tmpdir(), `.fuckclaw-m6-demo-${Date.now()}`);
  fs.mkdirSync(demoDir, { recursive: true });
  const runtime = await createFuckClawRuntime(
    {
      workspace: { root: demoDir },
      logging: { level: 'info' },
    },
    new Milestone6MockLLMProvider()
  );

  try {
    // =========================================================================
    // DEMO A: Multi-Step YAML Skill Manifest Execution (§10)
    // =========================================================================
    console.log('============================================================');
    console.log('DEMO A: Multi-Step YAML Skill Manifest Execution');
    console.log('============================================================\n');

    const sampleSkillYaml = `
id: skill_deploy_auth_microservice
name: deploy_auth_microservice
version: "1.0.0"
description: Multi-step deployment routine for auth-service microservice to staging
origin: user_defined
tags: [deployment, auth, microservice]

triggerPatterns:
  - "deploy auth service"
  - "deploy to staging"

inputs:
  - name: service_name
    type: string
    description: Name of the microservice
    required: true
    default: auth-service
  - name: environment
    type: string
    description: Target environment
    required: true
    default: staging
  - name: target_version
    type: string
    description: Semantic release tag
    required: true
    default: v2.4.0

outputs:
  - name: manifest_file
    type: string
    description: Generated deployment manifest path
  - name: release_tag
    type: string
    description: Deployed release tag

requiredTools: [filesystem, shell]

steps:
  - id: write_deployment_spec
    action:
      type: tool_call
      tool: filesystem
      argsTemplate:
        action: write
        path: "workspace/deployments/auth-service-staging.json"
        content: '{"service":"{{service_name}}","env":"{{environment}}","version":"{{target_version}}","deployedAt":"2026-08-07T22:00:00Z"}'
    onFailure: abort

  - id: analyze_service_health
    action:
      type: llm_reason
      prompt: |
        Perform service health check and verification for:
        Service: {{service_name}}
        Environment: {{environment}}
        Target Version: {{target_version}}
      outputVar: health_report
    onFailure: abort

  - id: verify_deployment_artifact
    action:
      type: tool_call
      tool: filesystem
      argsTemplate:
        action: read
        path: "workspace/deployments/auth-service-staging.json"
    onFailure: abort
`;

    console.log('1. Parsing and registering YAML skill manifest: "deploy_auth_microservice"...');
    const manifest = ManifestParser.parse(sampleSkillYaml);
    await runtime.skillsEngine.register(manifest);

    const registeredSkill = runtime.skillsEngine.get('skill_deploy_auth_microservice');
    console.log(`- Registered Skill ID: ${registeredSkill.id} (version ${registeredSkill.version})`);
    console.log(`- Description: ${registeredSkill.description}`);
    console.log(`- Required Tools: [${registeredSkill.requiredTools.join(', ')}]`);
    console.log(`- Total Steps: ${registeredSkill.steps.length}\n`);

    console.log('2. Executing multi-step deployment skill via Skills Engine...');
    const executionResult = await runtime.skillsEngine.execute('skill_deploy_auth_microservice', {
      service_name: 'auth-service',
      environment: 'staging',
      target_version: 'v2.4.0-rc1',
      manifest_file: 'workspace/deployments/auth-service-staging.json',
      release_tag: 'v2.4.0-rc1',
    });

    console.log('\nSkill Execution Result:');
    console.log(`- Success: ${executionResult.success}`);
    console.log(`- Steps Executed: ${executionResult.stepsExecuted}/${registeredSkill.steps.length}`);
    console.log(`- Steps Failed: ${executionResult.stepsFailed}`);
    console.log(`- Steps Skipped: ${executionResult.stepsSkipped}`);
    console.log(`- Execution Duration: ${executionResult.durationMs}ms`);
    console.log(`- Estimated Token Cost: $${executionResult.tokenCost.toFixed(6)}`);

    const writtenManifestPath = path.join(demoDir, 'workspace', 'deployments', 'auth-service-staging.json');
    const fileExists = fs.existsSync(writtenManifestPath);
    console.log(`- Deployment Artifact Written to Disk: ${fileExists} (${writtenManifestPath})`);
    if (fileExists) {
      console.log(`- Artifact Content: ${fs.readFileSync(writtenManifestPath, 'utf8')}`);
    }

    const skillStats = runtime.skillsEngine.getStats('skill_deploy_auth_microservice');
    console.log(`- Skill Registry Stats: Total Executions: ${skillStats.totalExecutions}, Success Rate: ${(skillStats.successRate * 100).toFixed(1)}%\n`);

    // =========================================================================
    // DEMO B: Knowledge Graph Population & Recursive CTE Traversal (§8)
    // =========================================================================
    console.log('============================================================');
    console.log('DEMO B: Knowledge Graph Entity Storage & Recursive CTE Traversal');
    console.log('============================================================\n');

    console.log('1. Populating Knowledge Graph with enterprise topology...');
    // Entities:
    // Alice (Person) -> WORKS_AT -> Acme Corp (Organization)
    // Alice (Person) -> WORKS_ON -> auth-service (Project)
    // auth-service (Project) -> DEPENDS_ON -> user-db (Project)
    // auth-service (Project) -> DEPLOYED_TO -> staging (Environment)
    // user-db (Project) -> USES -> PostgreSQL (Concept)
    // Decision 1 (Decision) -> AFFECTS -> auth-service (Project)
    // Alice (Person) -> DECIDED -> Decision 1 (Decision)

    const alice = await runtime.knowledgeGraph.createEntity({
      type: 'person',
      name: 'Alice',
      aliases: ['@alice', 'alice@acme.corp'],
      description: 'Principal Security & Auth Engineer',
      properties: { role: 'tech_lead', team: 'platform' },
    });

    const acme = await runtime.knowledgeGraph.createEntity({
      type: 'organization',
      name: 'Acme Corp',
      description: 'Enterprise Cloud Infrastructure Company',
    });

    const authService = await runtime.knowledgeGraph.createEntity({
      type: 'project',
      name: 'auth-service',
      aliases: ['authentication-microservice'],
      description: 'OAuth2 & OIDC Authentication Gateway',
      properties: { language: 'TypeScript', port: 8080 },
    });

    const userDb = await runtime.knowledgeGraph.createEntity({
      type: 'project',
      name: 'user-db',
      description: 'High-availability user state datastore',
      properties: { engine: 'PostgreSQL', replicas: 3 },
    });

    const stagingEnv = await runtime.knowledgeGraph.createEntity({
      type: 'environment',
      name: 'staging-k8s',
      description: 'Staging Kubernetes cluster on AWS eu-central-1',
    });

    const postgres = await runtime.knowledgeGraph.createEntity({
      type: 'concept',
      name: 'PostgreSQL',
      description: 'ACID relational database engine with JSONB support',
    });

    const dec1 = await runtime.knowledgeGraph.createEntity({
      type: 'decision',
      name: 'Adopt JWT + Refresh Tokens',
      description: 'Decision to migrate session cookies to distributed JWT tokens',
      properties: { rationale: 'Stateless scaling across Kubernetes pods', status: 'approved' },
    });

    // Relationships (Edges)
    await runtime.knowledgeGraph.createRelationship({ fromId: alice.id, toId: acme.id, type: 'WORKS_AT' });
    await runtime.knowledgeGraph.createRelationship({ fromId: alice.id, toId: authService.id, type: 'WORKS_ON' });
    await runtime.knowledgeGraph.createRelationship({ fromId: alice.id, toId: dec1.id, type: 'DECIDED' });
    await runtime.knowledgeGraph.createRelationship({ fromId: dec1.id, toId: authService.id, type: 'AFFECTS' });
    await runtime.knowledgeGraph.createRelationship({ fromId: authService.id, toId: userDb.id, type: 'DEPENDS_ON' });
    await runtime.knowledgeGraph.createRelationship({ fromId: authService.id, toId: stagingEnv.id, type: 'DEPLOYED_TO' });
    await runtime.knowledgeGraph.createRelationship({ fromId: userDb.id, toId: postgres.id, type: 'USES' });

    console.log('Entities and Relationships successfully indexed into SQLite.');

    console.log('\n2. Executing Recursive CTE Neighborhood Queries:');

    // 1-Hop from Alice
    const hop1 = await runtime.knowledgeGraph.getNeighbors(alice.id, 1);
    console.log(`\n- [1-Hop Neighborhood from Alice] (Depth 1):`);
    console.log(`  Center: ${hop1.center.name} (${hop1.center.type})`);
    console.log(`  Connected Entities (${hop1.entities.length}):`);
    for (const e of hop1.entities) {
      if (e.id !== alice.id) {
        console.log(`   * ${e.name} [${e.type}]`);
      }
    }

    // 2-Hop from Alice
    const hop2 = await runtime.knowledgeGraph.getNeighbors(alice.id, 2);
    console.log(`\n- [2-Hop Neighborhood from Alice] (Depth 2 - Recursive CTE):`);
    console.log(`  Connected Entities (${hop2.entities.length}):`);
    for (const e of hop2.entities) {
      if (e.id !== alice.id) {
        console.log(`   * ${e.name} [${e.type}]`);
      }
    }

    // 3-Hop from Alice (Reaches user-db -> PostgreSQL)
    const hop3 = await runtime.knowledgeGraph.getNeighbors(alice.id, 3);
    console.log(`\n- [3-Hop Neighborhood from Alice] (Depth 3 - Multi-Hop Recursive Expansion):`);
    console.log(`  Connected Entities (${hop3.entities.length}):`);
    for (const e of hop3.entities) {
      if (e.id !== alice.id) {
        console.log(`   * ${e.name} [${e.type}]`);
      }
    }

    console.log('\n3. Executing Recursive CTE Shortest Path Traversal:');
    const pathResult = await runtime.knowledgeGraph.findPath(alice.id, postgres.id, 5);
    console.log(`- Path from Alice -> PostgreSQL:`);
    if (pathResult) {
      console.log(`  Traversal Steps: ${pathResult.entities.map((e) => `${e.name} (${e.type})`).join(' -> ')}`);
      console.log(`  Total Hops / Weight: ${pathResult.relationships.length} edges`);
    }

    console.log('\n4. Knowledge Graph Statistics:');
    const stats = await runtime.knowledgeGraph.stats();
    console.log(`- Total Entities: ${stats.entityCount}`);
    console.log(`- Total Relationships: ${stats.relationshipCount}`);
    console.log(`- Entity Breakdown:`, stats.entityCountByType);
    console.log(`- Average Node Degree: ${stats.averageDegree.toFixed(2)}`);
    console.log(`- Top Connected Entity: ${stats.mostConnectedEntities[0]?.entity.name} (Degree: ${stats.mostConnectedEntities[0]?.degree})`);

    console.log('\n=== Milestone 6: Structural Knowledge & Skills Verified Successfully ===');
  } finally {
    await runtime.shutdown();
    fs.rmSync(demoDir, { recursive: true, force: true });
  }
}

runMilestone6Demo().catch((err) => {
  console.error('Milestone 6 Demonstration Failed:', err);
  process.exit(1);
});
