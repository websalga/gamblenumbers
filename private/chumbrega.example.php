<?php
// Configurações de conexão
// Se o script rodar no mesmo servidor, use "127.0.0.1" ou "localhost"
// Se rodar de outra máquina, coloque o IP do Photon OS (ex: 192.168.18.108)
$serverName = 'SEU_SERVIDOR_SQL';

// A porta padrão é 1433. Se mudou, use "127.0.0.1,PORTA"
$database = 'bitcoin';
$username = 'seu_usuario';
$password = 'sua_senha';

try {
    // String de Conexão (DSN)
    // $dsn = "sqlsrv:server=$serverName;Database=$database";
    $dsn = "sqlsrv:server=$serverName;Database=$database;TrustServerCertificate=true";    
    // Opções para tratamento de erro e timeout
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, // Lança exceções em caso de erro
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, // Retorna arrays associativos
        PDO::SQLSRV_ATTR_ENCODING => PDO::SQLSRV_ENCODING_UTF8 // Garante caracteres corretos
    ];

    // Tenta criar a conexão
    $conn = new PDO($dsn, $username, $password, $options);

    echo "<h1>Sucesso!</h1>";
    echo "<p>Conexão com o SQL Server estabelecida.</p>";

    // Teste simples: Pegar a versão do banco
    $sql = "SELECT @@VERSION as versao";
    $stmt = $conn->query($sql);
    $row = $stmt->fetch();

    echo "<strong>Versão do Servidor:</strong><br>";
    echo "<pre>" . $row['versao'] . "</pre>";

} catch (PDOException $e) {
    // Em caso de erro, mostra na tela
    echo "<h1>Erro na Conexão</h1>";
    echo "<p style='color:red'>" . $e->getMessage() . "</p>";
}
phpinfo();
?>

