// Family suitability must be supported by published wording, never inferred
// from the venue's name, membership, popularity, or category alone.
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/<[^>]*>/g,' ');
const FAMILY_REQUEST=/\b(ninos?|ninas?|peques?|pequenos?|hijos?|hijas?|familia|familiar(?:es)?|kids?|children|child|family|families|criancas?|filhos?|filhas?)\b/;
function audienceRequest(message){
  const text=normalize(message);
  if(/\b(sin ninos|sin ninas|sin los ninos|sin mis hijos|sin hijos|no tiene que ser familiar|sin importar si es familiar|without (?:kids|children)|without my (?:kids|children)|not necessarily family.friendly|sem criancas|sem filhos|nao precisa ser familiar|solo adultos|adults only|apenas adultos)\b/.test(text))return 'clear';
  return FAMILY_REQUEST.test(text)?'family':null;
}
function evidence(item){
  if(item.is_age_restricted===true || item.isAgeRestricted===true)return false;
  const fields=[item.title,item.description,item.category,...(Array.isArray(item.tags)?item.tags:[]),item.recommendation,...(Array.isArray(item.includes)?item.includes:[]),item.member_benefit_details,item.benefit_instructions];
  const text=fields.map(normalize).join(' . ');
  // Restrictions always take precedence over promotional family wording.
  if(/\b(?:18|21)\s*\+/.test(text))return false;
  if(/\b(?:not (?:a |an )?(?:(?:family|kid|kids|child|children)[ -]friendly|for (?:kids|children))|no (?:es |son )?(?:un |una )?(?:(?:plan|experiencia) familiar|apt[oa]s? para (?:ninos|ninas|menores))|nao (?:e |sao )?(?:um |uma )?(?:passeio familiar|adequad[oa]s? para criancas))\b/.test(text))return false;
  if(/\b(adults?.only|solo (?:para )?adultos|somente (?:para )?adultos|apenas (?:para )?adultos|mayores de (?:18|21)|maiores de (?:18|21)|(?:ages?|aged) (?:18|21)\s*(?:and over|or older|and older)|(?:18|21)\s*\+|no (?:se )?(?:admiten|permiten|aceptan) (?:a )?(?:ninos|ninas|menores)|not (?:suitable|recommended) for (?:kids|children)|nao (?:e )?(?:recomendad[oa]|adequad[oa]) para criancas|no recomendad[oa] para (?:ninos|ninas))\b/.test(text))return false;
  if(/\b(?:family|kid|kids|child|children)[ -]friendly\b/.test(text))return true;
  if(/\b(?:para (?:toda la |toda a |a |la )?(?:familia|familias|ninos|ninas|criancas)|(?:plan|paseo|passeio|ambiente|experiencia|actividad|actividad(?:es)?|programa|evento) familiar(?:es)?|(?:apto|apta|adecuado|adecuada|ideal|recomendado|recomendada|pensado|pensada|disenado|disenada)s? para (?:ninos|ninas|criancas)|todas las edades|todas as idades|all ages|(?:for|with) (?:the whole family|families|kids|children)|children (?:aged|ages)|ninos (?:desde|de|menores|mayores)|criancas (?:de|a partir))\b/.test(text))return true;
  return (item.tags||[]).some(tag=>/^(?:familiar|familia|familias|family|families|kids|children|ninos|ninas|criancas)$/.test(normalize(tag).trim()));
}
module.exports={audienceRequest,evidence};
