param(
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$TypeName
)

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
$clients = [System.Collections.Generic.List[System.Net.Sockets.TcpClient]]::new()

function Send-Message {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [byte]$Type,
        [byte[]]$Payload
    )
    $header = [System.BitConverter]::GetBytes([uint32]$Payload.Length)
    $Stream.Write($header, 0, $header.Length)
    $Stream.WriteByte($Type)
    if ($Payload.Length -gt 0) {
        $Stream.Write($Payload, 0, $Payload.Length)
    }
    $Stream.Flush()
}

function New-SettingsPayload {
    $payload = [byte[]]::new(36)
    [System.Array]::Copy([System.BitConverter]::GetBytes([int]7), 0, $payload, 0, 4)
    return $payload
}

try {
    $listener.Start()
    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()
    for ($index = 0; $index -lt 2; $index += 1) {
        $client = $listener.AcceptTcpClient()
        $clients.Add($client)
        $stream = $client.GetStream()
        Send-Message -Stream $stream -Type 31 -Payload (New-SettingsPayload)
        $json = '{"' + $TypeName + '":{"properties":{},"methods":{}}}'
        $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $stringLength = [System.BitConverter]::GetBytes([int]($jsonBytes.Length + 1))
        $payload = [byte[]]::new($stringLength.Length + $jsonBytes.Length + 1)
        [System.Array]::Copy($stringLength, 0, $payload, 0, $stringLength.Length)
        [System.Array]::Copy($jsonBytes, 0, $payload, $stringLength.Length, $jsonBytes.Length)
        Send-Message -Stream $stream -Type 2 -Payload $payload
        Send-Message -Stream $stream -Type 26 -Payload ([byte[]]::new(0))
    }
    Start-Sleep -Milliseconds 1200
}
finally {
    foreach ($client in $clients) {
        $client.Dispose()
    }
    $listener.Stop()
}
