# BTC Simulador — versão PHP (Nginx + PDO_SQLSRV) no Photon OS

Aproveita seu Nginx + PHP com driver de SQL Server já instalados. Não precisa
de Node. O dashboard (estático) chama `api.php`, que lê `bitcoin.dbo.snapshots`
e devolve JSON.

## Arquivos

    index.html      dashboard
    app.js          lógica do dashboard (chama api.php)
    forecast.js     modelo de projeção estatística
    api.php         endpoint que lê o SQL Server (PDO_SQLSRV)
    config.example.php   modelo de credenciais -> copie para config.php

## Instalação

Destino no seu servidor: `/usr/share/nginx/html/gamblenumbers`

1. Transfira por FTP todos os arquivos para essa pasta.

2. Confirme o driver PHP de SQL Server:

       php -m | grep -i sqlsrv

   Deve listar `pdo_sqlsrv` (e provavelmente `sqlsrv`). O `api.php` usa
   PDO_SQLSRV. Se você tiver SÓ `sqlsrv` (procedural, sem PDO), me avise que
   entrego a variante procedural.

3. Crie o config com as credenciais (NUNCA versione o config.php real):

       cd /usr/share/nginx/html/gamblenumbers
       cp config.example.php config.php
       vi config.php     # preencha servidor, usuário, senha

4. Ajuste permissões para o usuário do PHP-FPM (no Photon costuma ser `nginx`):

       chown -R nginx:nginx /usr/share/nginx/html/gamblenumbers
       chmod 640 config.php

5. Acesse:

       http://IP_DO_PHOTON/gamblenumbers/

   Se a página carregar e mostrar "Cotações reais carregadas", funcionou.

## Teste rápido do endpoint

    curl "http://localhost/gamblenumbers/api.php?acao=atual"

Deve retornar um JSON com `"ok":true` e o último snapshot. Se retornar
`"ok":false`, veja o log de erro do PHP (o detalhe real não é exposto ao
cliente por segurança):

    tail -n 50 /var/log/php-fpm/www-error.log   # caminho pode variar

## Nginx

Se já serve PHP nessa webroot, provavelmente nada muda. O bloco típico que
faz o PHP funcionar é algo assim (apenas para referência, NÃO sobrescreva sua
config sem conferir):

    location ~ \.php$ {
        include        fastcgi_params;
        fastcgi_pass   unix:/run/php-fpm/www.sock;   # confira seu socket
        fastcgi_param  SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }

## Segurança

- Credenciais só no `config.php`. Como é PHP, o Nginx o executa — o conteúdo
  não é servido como texto. Para camada extra, mova `config.php` para fora da
  webroot e ajuste o `require` no topo de `api.php` para o caminho absoluto.
- O `api.php` só faz SELECT nas colunas de cotação; não escreve no banco.
- O Photon precisa alcançar a porta 1433 do SQL Server. Teste:

      curl -v telnet://IP_DO_SQL_SERVER:1433

## Aviso

A metade direita do gráfico é uma projeção estatística (tendência,
volatilidade, ciclos e reversão à média calculados sobre o seu histórico
real). É um cenário plausível para visualização e simulação, NÃO uma
recomendação nem previsão garantida. Nenhum método prevê o preço futuro de um
ativo de forma confiável.
