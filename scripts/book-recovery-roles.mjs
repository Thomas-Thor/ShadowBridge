// Host-only, authenticated backup recovery. No runtime or normal startup use.
export function archiveHasBook(catalog){
 if(typeof catalog!=='string'||Buffer.byteLength(catalog)>4*1024*1024)throw Error('Invalid recovery catalog');
 return /^\d+; \d+ \d+ SCHEMA - owner_book \S+\s*$/m.test(catalog);
}
export const restoredBookRolesSql=`DO $book_recovery$
BEGIN
 IF current_user<>'postgres' OR current_database()<>'shadowbridge'
  OR to_regnamespace('sb') IS NOT NULL OR to_regnamespace('owner_book') IS NOT NULL
  OR EXISTS(SELECT FROM information_schema.tables WHERE table_schema='auth') THEN
  RAISE EXCEPTION 'Command Book recovery requires an empty recovery target' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='shadowbridge_book_executor') THEN
  RAISE EXCEPTION 'Existing Command Book recovery role requires review' USING ERRCODE='42501';
 END IF;
 CREATE ROLE shadowbridge_book_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
END $book_recovery$;`;
