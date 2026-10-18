-- 2026-10-18 — textos da tela de robôs: prazo de referência da queda e teto por robô (11 idiomas)
-- 2026-10-18 — bot screen texts: drop reference window and per-bot cap (11 languages)
-- Banco: bitcoin, tabela dbo.Site_Textos. Idempotente / idempotent.

IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'de-DE', N'Geben Sie einen Zeitraum zwischen 5 Minuten und 30 Tagen ein.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'en-US', N'Enter a window between 5 minutes and 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'es-ES', N'Ingrese un plazo entre 5 minutos y 30 días.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'fr-FR', N'Saisissez une période entre 5 minutes et 30 jours.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'it-IT', N'Inserisci un periodo tra 5 minuti e 30 giorni.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'ja-JP', N'Enter a window between 5 minutes and 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'nl-NL', N'Voer een periode in tussen 5 minuten en 30 dagen.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'pt-BR', N'Informe um prazo entre 5 minutos e 30 dias.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'ru-RU', N'Enter a window between 5 minutes and 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'tr-TR', N'Enter a window between 5 minutes and 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_prazo_ref' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_prazo_ref', 'zh-CN', N'Enter a window between 5 minutes and 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'de-DE', N'Geben Sie eine Obergrenze zwischen 1 und 100 ein.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'en-US', N'Enter a cap between 1 and 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'es-ES', N'Ingrese un tope entre 1 y 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'fr-FR', N'Saisissez un plafond entre 1 et 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'it-IT', N'Inserisci un tetto tra 1 e 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'ja-JP', N'Enter a cap between 1 and 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'nl-NL', N'Voer een limiet in tussen 1 en 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'pt-BR', N'Informe um teto entre 1 e 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'ru-RU', N'Enter a cap between 1 and 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'tr-TR', N'Enter a cap between 1 and 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_erro_teto' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_erro_teto', 'zh-CN', N'Enter a cap between 1 and 100.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'de-DE', N'Referenzzeitraum für den Rückgang');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'en-US', N'Drop reference window');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'es-ES', N'Plazo de referencia de la caída');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'fr-FR', N'Période de référence de la baisse');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'it-IT', N'Periodo di riferimento del calo');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'ja-JP', N'Drop reference window');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'nl-NL', N'Referentieperiode voor de daling');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'pt-BR', N'Prazo de referência da queda');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'ru-RU', N'Drop reference window');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'tr-TR', N'Drop reference window');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref', 'zh-CN', N'Drop reference window');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'de-DE', N'Standard: 24 Stunden. Von 5 Minuten bis 30 Tage.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'en-US', N'Default: 24 hours. From 5 minutes to 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'es-ES', N'Predeterminado: 24 horas. De 5 minutos a 30 días.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'fr-FR', N'Par défaut : 24 heures. De 5 minutes à 30 jours.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'it-IT', N'Predefinito: 24 ore. Da 5 minuti a 30 giorni.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'ja-JP', N'Default: 24 hours. From 5 minutes to 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'nl-NL', N'Standaard: 24 uur. Van 5 minuten tot 30 dagen.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'pt-BR', N'Padrão: 24 horas. De 5 minutos a 30 dias.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'ru-RU', N'Default: 24 hours. From 5 minutes to 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'tr-TR', N'Default: 24 hours. From 5 minutes to 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_hint' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_hint', 'zh-CN', N'Default: 24 hours. From 5 minutes to 30 days.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'de-DE', N'Der Roboter vergleicht den aktuellen Preis mit dem Hoch in diesem Zeitraum. Bsp.: 24 Stunden = kauft, wenn der Preis um den Kaufprozentsatz (plus Gebühren) unter das 24-Stunden-Hoch fällt.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'en-US', N'The bot compares the current price with the highest price in this window. Ex.: 24 hours = buys when the price falls the buy percentage (plus fees) below the 24-hour high.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'es-ES', N'El robot compara el precio actual con el máximo de este plazo. Ej.: 24 horas = compra cuando el precio cae el porcentaje de compra (más comisiones) por debajo del máximo de las últimas 24 horas.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'fr-FR', N'Le robot compare le prix actuel au plus haut de cette période. Ex. : 24 heures = achète quand le prix baisse du pourcentage d''achat (plus frais) sous le plus haut des 24 dernières heures.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'it-IT', N'Il robot confronta il prezzo attuale con il massimo di questo periodo. Es.: 24 ore = acquista quando il prezzo scende della percentuale di acquisto (più commissioni) sotto il massimo delle ultime 24 ore.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'ja-JP', N'The bot compares the current price with the highest price in this window. Ex.: 24 hours = buys when the price falls the buy percentage (plus fees) below the 24-hour high.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'nl-NL', N'De robot vergelijkt de huidige prijs met de hoogste prijs in deze periode. Bijv.: 24 uur = koopt als de prijs het koopprocent (plus kosten) onder de 24-uurs top zakt.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'pt-BR', N'O robô compara o preço atual com a máxima desse prazo. Ex.: 24 horas = compra quando o preço cair o percentual de compra (mais taxas) abaixo da máxima das últimas 24 horas.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'ru-RU', N'The bot compares the current price with the highest price in this window. Ex.: 24 hours = buys when the price falls the buy percentage (plus fees) below the 24-hour high.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'tr-TR', N'The bot compares the current price with the highest price in this window. Ex.: 24 hours = buys when the price falls the buy percentage (plus fees) below the 24-hour high.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_prazo_ref_tip' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_prazo_ref_tip', 'zh-CN', N'The bot compares the current price with the highest price in this window. Ex.: 24 hours = buys when the price falls the buy percentage (plus fees) below the 24-hour high.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'de-DE', N'Obergrenze pro Roboter (% des freien Guthabens)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'en-US', N'Bot cap (% of free balance)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'es-ES', N'Tope por robot (% del saldo libre)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'fr-FR', N'Plafond par robot (% du solde libre)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'it-IT', N'Tetto per robot (% del saldo libero)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'ja-JP', N'Bot cap (% of free balance)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'nl-NL', N'Limiet per robot (% van vrij saldo)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'pt-BR', N'Teto por robô (% do saldo livre)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'ru-RU', N'Bot cap (% of free balance)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'tr-TR', N'Bot cap (% of free balance)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct', 'zh-CN', N'Bot cap (% of free balance)');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'de-DE', N'Standard: 20 %. Hält Geld für größere Einbrüche zurück. Roboter desselben Kontos teilen sich dasselbe freie Guthaben. Gilt nicht für den Crash-Kauf-Auslöser.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'en-US', N'Default: 20%. Keeps money for bigger drops. Bots on the same account share the same free balance. Does not apply to the crash-buy trigger.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'es-ES', N'Predeterminado: 20%. Guarda dinero para caídas mayores. Los robots de la misma cuenta comparten el mismo saldo libre. No se aplica a la compra en caída fuerte.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'fr-FR', N'Par défaut : 20 %. Garde de l''argent pour des baisses plus fortes. Les robots d''un même compte partagent le même solde libre. Ne s''applique pas à l''achat en forte baisse.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'it-IT', N'Predefinito: 20%. Tiene denaro per cali maggiori. I robot dello stesso conto condividono lo stesso saldo libero. Non vale per l''acquisto in forte ribasso.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'ja-JP', N'Default: 20%. Keeps money for bigger drops. Bots on the same account share the same free balance. Does not apply to the crash-buy trigger.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'nl-NL', N'Standaard: 20%. Houdt geld achter voor grotere dalingen. Robots op hetzelfde account delen hetzelfde vrije saldo. Geldt niet voor de crash-koopdrempel.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'pt-BR', N'Padrão: 20%. Guarda dinheiro para quedas maiores. Robôs da mesma conta dividem o mesmo saldo livre. Não vale para a compra em queda forte.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'ru-RU', N'Default: 20%. Keeps money for bigger drops. Bots on the same account share the same free balance. Does not apply to the crash-buy trigger.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'tr-TR', N'Default: 20%. Keeps money for bigger drops. Bots on the same account share the same free balance. Does not apply to the crash-buy trigger.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_hint' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_hint', 'zh-CN', N'Default: 20%. Keeps money for bigger drops. Bots on the same account share the same free balance. Does not apply to the crash-buy trigger.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'de-DE', N'Der Roboter kauft nur, wenn seine offenen Lose plus das neue Los innerhalb dieses Prozentsatzes des aktuellen freien Guthabens bleiben.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'en-US', N'The bot only buys if its open lots plus the new lot stay within this percentage of the account''s current free balance.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'es-ES', N'El robot solo compra si sus lotes abiertos, más el nuevo lote, quedan dentro de este porcentaje del saldo libre actual de la cuenta.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'fr-FR', N'Le robot n''achète que si ses lots ouverts, plus le nouveau lot, restent dans ce pourcentage du solde libre actuel du compte.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'it-IT', N'Il robot acquista solo se i suoi lotti aperti, più il nuovo lotto, restano entro questa percentuale del saldo libero attuale del conto.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'ja-JP', N'The bot only buys if its open lots plus the new lot stay within this percentage of the account''s current free balance.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'nl-NL', N'De robot koopt alleen als zijn open loten plus het nieuwe lot binnen dit percentage van het huidige vrije saldo van de rekening blijven.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'pt-BR', N'O robô só compra se os lotes abertos dele, somados ao novo lote, ficarem até este percentual do saldo livre da conta no momento.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'ru-RU', N'The bot only buys if its open lots plus the new lot stay within this percentage of the account''s current free balance.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'tr-TR', N'The bot only buys if its open lots plus the new lot stay within this percentage of the account''s current free balance.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_teto_saldo_pct_tip' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_teto_saldo_pct_tip', 'zh-CN', N'The bot only buys if its open lots plus the new lot stay within this percentage of the account''s current free balance.');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'de-DE', N'Tage');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'en-US', N'days');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'es-ES', N'días');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'fr-FR', N'jours');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'it-IT', N'giorni');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'ja-JP', N'days');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'nl-NL', N'dagen');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'pt-BR', N'dias');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'ru-RU', N'days');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'tr-TR', N'days');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_dias' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_dias', 'zh-CN', N'days');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'de-DE', N'Stunden');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'en-US', N'hours');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'es-ES', N'horas');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'fr-FR', N'heures');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'it-IT', N'ore');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'ja-JP', N'hours');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'nl-NL', N'uur');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'pt-BR', N'horas');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'ru-RU', N'hours');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'tr-TR', N'hours');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_horas' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_horas', 'zh-CN', N'hours');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'de-DE')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'de-DE', N'Minuten');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'en-US')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'en-US', N'minutes');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'es-ES')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'es-ES', N'minutos');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'fr-FR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'fr-FR', N'minutes');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'it-IT')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'it-IT', N'minuti');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'ja-JP')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'ja-JP', N'minutes');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'nl-NL')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'nl-NL', N'minuten');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'pt-BR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'pt-BR', N'minutos');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'ru-RU')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'ru-RU', N'minutes');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'tr-TR')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'tr-TR', N'minutes');
IF NOT EXISTS (SELECT 1 FROM dbo.Site_Textos WHERE chave = 'automatos_unid_minutos' AND idioma = 'zh-CN')
    INSERT dbo.Site_Textos (chave, idioma, texto) VALUES ('automatos_unid_minutos', 'zh-CN', N'minutes');

-- a dica do percentual de compra deixa de citar os 30 minutos fixos / the buy-percentage hint no longer mentions the fixed 30 minutes
UPDATE dbo.Site_Textos SET texto = N'Mindestrückgang gegenüber dem Hoch im Referenzzeitraum, bevor der Roboter kauft (zuzüglich Netzwerk- und SideShift-Gebühren). Unabhängig von der gewünschten Rendite, die nur den Verkauf steuert.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'de-DE';
UPDATE dbo.Site_Textos SET texto = N'Minimum drop from the highest price in the reference window before the bot buys (added to network and SideShift fees). Independent of the desired return, which only controls selling.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'en-US';
UPDATE dbo.Site_Textos SET texto = N'Caída mínima respecto al máximo del plazo de referencia para que el robot compre (más las comisiones de red y SideShift). Independiente del retorno deseado, que solo controla la venta.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'es-ES';
UPDATE dbo.Site_Textos SET texto = N'Baisse minimale par rapport au plus haut de la période de référence avant que le robot achète (en plus des frais réseau et SideShift). Indépendant du rendement souhaité, qui ne contrôle que la vente.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'fr-FR';
UPDATE dbo.Site_Textos SET texto = N'Calo minimo rispetto al massimo del periodo di riferimento prima che il robot acquisti (più commissioni di rete e SideShift). Indipendente dal rendimento desiderato, che controlla solo la vendita.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'it-IT';
UPDATE dbo.Site_Textos SET texto = N'Minimum drop from the highest price in the reference window before the bot buys (added to network and SideShift fees). Independent of the desired return, which only controls selling.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'ja-JP';
UPDATE dbo.Site_Textos SET texto = N'Minimale daling t.o.v. de hoogste koers in de referentieperiode voordat de bot koopt (plus netwerk- en SideShift-kosten). Los van het gewenste rendement, dat alleen de verkoop stuurt.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'nl-NL';
UPDATE dbo.Site_Textos SET texto = N'Queda mínima em relação à máxima do prazo de referência para o robô comprar (somada às taxas de rede e SideShift). É independente do retorno desejado, que controla só a venda.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'pt-BR';
UPDATE dbo.Site_Textos SET texto = N'Minimum drop from the highest price in the reference window before the bot buys (added to network and SideShift fees). Independent of the desired return, which only controls selling.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'ru-RU';
UPDATE dbo.Site_Textos SET texto = N'Minimum drop from the highest price in the reference window before the bot buys (added to network and SideShift fees). Independent of the desired return, which only controls selling.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'tr-TR';
UPDATE dbo.Site_Textos SET texto = N'Minimum drop from the highest price in the reference window before the bot buys (added to network and SideShift fees). Independent of the desired return, which only controls selling.', atualizado_em = GETUTCDATE() WHERE chave = 'automatos_queda_compra_pct_hint' AND idioma = 'zh-CN';
GO
