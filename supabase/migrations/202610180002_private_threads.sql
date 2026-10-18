-- Anonymous opportunities can be individually shared with several companies.
-- Their correspondence must remain a separate company–ShadowBridge thread.
BEGIN;
ALTER TABLE sb.messages ADD COLUMN company_id uuid REFERENCES sb.companies(id);
UPDATE sb.messages m SET company_id=o.company_id FROM sb.offers o WHERE m.resource_type='offer' AND m.resource_public_id=o.public_id;
UPDATE sb.messages m SET company_id=r.company_id FROM sb.rfqs r WHERE m.resource_type='rfq' AND m.resource_public_id=r.public_id;
UPDATE sb.messages m SET company_id=p.company_id FROM sb.partner_proposals p WHERE m.resource_type='proposal' AND m.resource_public_id=p.public_id;
UPDATE sb.messages m SET company_id=(SELECT g.company_id FROM sb.opportunity_grants g JOIN sb.memberships member ON member.company_id=g.company_id AND member.role=g.role WHERE g.public_id=m.resource_public_id AND member.user_id=m.sender_user_id ORDER BY g.created_at LIMIT 1) WHERE m.resource_type='opportunity';
-- Refuse to guess a recipient for any pre-existing management message.
DO $$ BEGIN IF EXISTS(SELECT FROM sb.messages WHERE company_id IS NULL) THEN RAISE EXCEPTION 'Explicitly assign existing message recipients before applying private-thread migration'; END IF; END $$;
ALTER TABLE sb.messages ALTER COLUMN company_id SET NOT NULL;

CREATE FUNCTION sb.can_access_message(kind text, resource text, recipient_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE kind
 WHEN 'opportunity' THEN EXISTS(SELECT 1 FROM portal.opportunities p WHERE p.public_id=resource) AND (sb.is_staff() OR EXISTS(SELECT 1 FROM sb.opportunity_grants g JOIN portal.opportunities p ON p.public_id=g.public_id WHERE g.public_id=resource AND g.company_id=recipient_company AND g.active AND (g.expires_at IS NULL OR g.expires_at>now()) AND p.status='approved' AND sb.has_role(g.company_id,g.role)))
 WHEN 'offer' THEN EXISTS(SELECT 1 FROM sb.offers o WHERE o.public_id=resource AND o.company_id=recipient_company AND (sb.is_staff() OR sb.has_role(o.company_id,'supplier')))
 WHEN 'rfq' THEN EXISTS(SELECT 1 FROM sb.rfqs r WHERE r.public_id=resource AND r.company_id=recipient_company AND (sb.is_staff() OR sb.has_role(r.company_id,'buyer')))
 WHEN 'proposal' THEN EXISTS(SELECT 1 FROM sb.partner_proposals p WHERE p.public_id=resource AND p.company_id=recipient_company AND (sb.is_staff() OR sb.has_role(p.company_id,'partner')))
 ELSE false END
$$;
CREATE FUNCTION sb.assign_message_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual_company uuid;
BEGIN
 IF new.resource_type='offer' THEN SELECT company_id INTO actual_company FROM sb.offers WHERE public_id=new.resource_public_id;
 ELSIF new.resource_type='rfq' THEN SELECT company_id INTO actual_company FROM sb.rfqs WHERE public_id=new.resource_public_id;
 ELSIF new.resource_type='proposal' THEN SELECT company_id INTO actual_company FROM sb.partner_proposals WHERE public_id=new.resource_public_id;
 ELSIF new.resource_type='opportunity' THEN
  IF new.company_id IS NULL AND NOT sb.is_staff() THEN
   SELECT g.company_id INTO actual_company FROM sb.opportunity_grants g WHERE g.public_id=new.resource_public_id AND g.active AND (g.expires_at IS NULL OR g.expires_at>now()) AND sb.has_role(g.company_id,g.role) ORDER BY g.created_at LIMIT 1;
  ELSE actual_company=new.company_id; END IF;
 END IF;
 IF actual_company IS NULL OR (new.company_id IS NOT NULL AND new.company_id<>actual_company) THEN RAISE EXCEPTION 'An authorized company thread is required' USING ERRCODE='42501'; END IF;
 new.company_id=actual_company;
 IF NOT sb.can_access_message(new.resource_type,new.resource_public_id,new.company_id) THEN RAISE EXCEPTION 'Company thread not accessible' USING ERRCODE='42501'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER message_recipient BEFORE INSERT ON sb.messages FOR EACH ROW EXECUTE FUNCTION sb.assign_message_company();
DROP POLICY message_select ON sb.messages;
DROP POLICY message_insert ON sb.messages;
CREATE POLICY message_select ON sb.messages FOR SELECT TO shadowbridge_api USING(sb.can_access_message(resource_type,resource_public_id,company_id));
CREATE POLICY message_insert ON sb.messages FOR INSERT TO shadowbridge_api WITH CHECK(sender_user_id=sb.user_id() AND sb.can_access_message(resource_type,resource_public_id,company_id));
ALTER FUNCTION sb.can_access_message(text,text,uuid) OWNER TO shadowbridge_policy;
ALTER FUNCTION sb.assign_message_company() OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.can_access_message(text,text,uuid),sb.assign_message_company() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sb.can_access_message(text,text,uuid) TO shadowbridge_api;
CREATE INDEX messages_company_thread ON sb.messages(company_id,resource_type,resource_public_id,created_at);

CREATE OR REPLACE FUNCTION sb.publish_opportunity(source_offer uuid, sanitized_data jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE opportunity text;
BEGIN
 IF NOT sb.is_staff() THEN RAISE EXCEPTION 'Management permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sb.offers WHERE id=source_offer AND status='approved') THEN RAISE EXCEPTION 'Approved source offer required'; END IF;
 IF jsonb_typeof(sanitized_data)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(sanitized_data) k WHERE k NOT IN ('title','category','specification','quantity','unit','price','currency','incoterms','availability','validUntil')) THEN RAISE EXCEPTION 'Only approved anonymous opportunity fields are accepted'; END IF;
 IF EXISTS(SELECT FROM jsonb_each(sanitized_data) x WHERE NOT (jsonb_typeof(x.value)='string' OR (x.key IN ('quantity','price') AND jsonb_typeof(x.value)='number')) OR length(x.value #>> '{}')>2000) THEN RAISE EXCEPTION 'Anonymous card values must be short reviewed text or commercial numbers'; END IF;
 IF sanitized_data::text ~* '([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|https?://|www\.)' THEN RAISE EXCEPTION 'Contact information is forbidden in anonymous cards'; END IF;
 IF EXISTS(SELECT 1 FROM sb.offers o JOIN sb.companies c ON c.id=o.company_id WHERE o.id=source_offer AND (strpos(lower(sanitized_data::text),lower(c.legal_name))>0 OR (length(c.registration_number)>3 AND strpos(lower(sanitized_data::text),lower(c.registration_number))>0))) THEN RAISE EXCEPTION 'Source identity is forbidden in anonymous cards'; END IF;
 INSERT INTO portal.opportunities(data) VALUES(sanitized_data) RETURNING public_id INTO opportunity;
 INSERT INTO sb.opportunity_sources(public_id,offer_id) VALUES(opportunity,source_offer);
 RETURN opportunity;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname IN('shadowbridge_api','shadowbridge_sessions') AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Runtime roles must not bypass RLS'; END IF;
 IF pg_has_role('shadowbridge_api','shadowbridge_policy','MEMBER') OR pg_has_role('shadowbridge_sessions','shadowbridge_policy','MEMBER') THEN RAISE EXCEPTION 'Runtime roles must not inherit the policy role'; END IF;
END $$;
COMMIT;
