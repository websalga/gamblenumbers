-- =============================================================================
-- Site_Textos (S04, 02/11/2026): mensagem de recusa quando o no ou o saldo nao podem ser confirmados
-- (saque, swap e encerramento de conta). Nos 11 idiomas. Idempotente.
-- =============================================================================
INSERT INTO dbo.Site_Textos (chave, idioma, texto, atualizado_em)
SELECT v.chave, v.idioma, v.texto, GETDATE()
FROM (VALUES
 ('seg_e_servico_indisponivel','pt-BR',N'Serviço temporariamente indisponível. Nenhuma operação foi feita; tente novamente mais tarde.'),
 ('seg_e_servico_indisponivel','en-US',N'Service temporarily unavailable. Nothing was done; please try again later.'),
 ('seg_e_servico_indisponivel','es-ES',N'Servicio temporalmente no disponible. No se realizó ninguna operación; inténtalo de nuevo más tarde.'),
 ('seg_e_servico_indisponivel','fr-FR',N'Service temporairement indisponible. Aucune opération n''a été effectuée ; réessayez plus tard.'),
 ('seg_e_servico_indisponivel','de-DE',N'Dienst vorübergehend nicht verfügbar. Es wurde nichts ausgeführt; bitte versuchen Sie es später erneut.'),
 ('seg_e_servico_indisponivel','it-IT',N'Servizio temporaneamente non disponibile. Non è stata eseguita alcuna operazione; riprova più tardi.'),
 ('seg_e_servico_indisponivel','ja-JP',N'サービスは一時的に利用できません。操作は実行されていません。しばらくしてから再度お試しください。'),
 ('seg_e_servico_indisponivel','nl-NL',N'Dienst tijdelijk niet beschikbaar. Er is niets uitgevoerd; probeer het later opnieuw.'),
 ('seg_e_servico_indisponivel','ru-RU',N'Сервис временно недоступен. Операция не выполнена; попробуйте позже.'),
 ('seg_e_servico_indisponivel','tr-TR',N'Hizmet geçici olarak kullanılamıyor. Hiçbir işlem yapılmadı; lütfen daha sonra tekrar deneyin.'),
 ('seg_e_servico_indisponivel','zh-CN',N'服务暂时不可用。未执行任何操作，请稍后再试。')
) AS v(chave, idioma, texto)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Site_Textos s WHERE s.chave = v.chave AND s.idioma = v.idioma);
