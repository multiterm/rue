// Operator-only initializer. Run once against a new Rue PostgreSQL service.
// Mount mode-0600 administrator-password and roles.json files at /operator-secrets.
import postgres from 'postgres'
import {readFileSync,lstatSync} from 'node:fs'
const environments=['development','preview','production'],kinds=['runtime','migration','backup']
const host=process.env.RUE_POSTGRES_HOST??'rue-postgres17'
function privateFile(name){const path='/operator-secrets/'+name,stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.nlink!==1)throw Error('private_file_required');return readFileSync(path,'utf8')}
async function main(){
 const roles=JSON.parse(privateFile('roles.json')),password=privateFile('administrator-password').trim()
 for(const env of environments)for(const kind of kinds)if(!/^[A-Za-z0-9_-]{64}$/.test(roles[env]?.[kind]??''))throw Error('invalid_role_secret')
 const admin=postgres({host,user:'rue_admin',password,database:'postgres',max:1,onnotice:()=>{}})
 try{
  const existing=await admin`SELECT datname AS name FROM pg_database WHERE datname IN ${admin(environments.map(env=>'rue_'+env))} UNION ALL SELECT rolname FROM pg_roles WHERE rolname IN ${admin(environments.flatMap(env=>kinds.map(kind=>'rue_'+env+'_'+kind)))}`
  if(existing.length)throw Error('existing_rue_storage_requires_review')
  for(const env of environments){
   const database='rue_'+env,migration=database+'_migration',runtime=database+'_runtime',backup=database+'_backup'
   for(const kind of kinds){
    // Names are fixed and passwords are restricted to generated base64url.
    // Never log a database error: utility SQL necessarily contains the secret.
    await admin.unsafe(`CREATE ROLE ${database}_${kind} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${roles[env][kind]}'`)
   }
   await admin.unsafe(`CREATE DATABASE ${database} OWNER ${migration}`)
   await admin.unsafe(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`)
   await admin.unsafe(`GRANT CONNECT ON DATABASE ${database} TO ${runtime},${backup}`)
   const db=postgres({host,user:'rue_admin',password,database,max:1,onnotice:()=>{}})
   try{
    await db.unsafe(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
    await db.unsafe(`GRANT USAGE ON SCHEMA public TO ${runtime},${backup}`)
    await db.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${runtime}`)
    await db.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${runtime}`)
    await db.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public GRANT SELECT ON TABLES TO ${backup}`)
    await db.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${backup}`)
   }finally{await db.end({timeout:5})}
   const runtimeDb=postgres({host,user:runtime,password:roles[env].runtime,database,max:1,onnotice:()=>{}})
   try{
    const [rights]=await runtimeDb`SELECT has_schema_privilege(current_user,'public','USAGE') AS can_use,has_schema_privilege(current_user,'public','CREATE') AS can_create`
    if(!rights.can_use||rights.can_create)throw Error('runtime_permissions_invalid')
   }finally{await runtimeDb.end({timeout:5})}
  }
  for(const name of ['postgres','template1'])await admin.unsafe(`REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`)
  const wrong=postgres({host,user:'rue_development_runtime',password:roles.development.runtime,database:'rue_preview',max:1,onnotice:()=>{}})
  try{let denied=false;try{await wrong`SELECT 1`}catch(error){denied=error.code==='42501'}if(!denied)throw Error('cross_environment_access_not_denied')}finally{await wrong.end({timeout:5})}
  console.log(JSON.stringify({provisioned:environments,rolesPerEnvironment:kinds,runtimeDdlDenied:true,crossEnvironmentConnectDenied:true,applicationDataImported:false}))
 }finally{await admin.end({timeout:5})}
}
main().catch(()=>{console.error('rue_postgres_role_provision_failed; credentials and SQL withheld; inspect before retrying');process.exitCode=1})
