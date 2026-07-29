param(
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [Parameter(Mandatory = $true)][int]$Port
)

function New-Frame {
    param([byte]$Type, [byte[]]$Payload)
    $header = [System.BitConverter]::GetBytes([uint32]$Payload.Length)
    $frame = [byte[]]::new(5 + $Payload.Length)
    [System.Array]::Copy($header, 0, $frame, 0, 4)
    $frame[4] = $Type
    if ($Payload.Length -gt 0) {
        [System.Array]::Copy($Payload, 0, $frame, 5, $Payload.Length)
    }
    return $frame
}

function Send-Frame {
    param([System.Net.Sockets.NetworkStream]$Stream, [byte[]]$Frame)
    $Stream.Write($Frame, 0, $Frame.Length)
    $Stream.Flush()
}

function New-SettingsFrame {
    $payload = [byte[]]::new(36)
    [System.Array]::Copy([System.BitConverter]::GetBytes([int]7), 0, $payload, 0, 4)
    return New-Frame -Type 31 -Payload $payload
}

function New-DebugDatabaseFrame {
    param([string]$Json)
    $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $stringLength = [System.BitConverter]::GetBytes([int]($jsonBytes.Length + 1))
    $payload = [byte[]]::new($stringLength.Length + $jsonBytes.Length + 1)
    [System.Array]::Copy($stringLength, 0, $payload, 0, $stringLength.Length)
    [System.Array]::Copy($jsonBytes, 0, $payload, $stringLength.Length, $jsonBytes.Length)
    return New-Frame -Type 2 -Payload $payload
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
$clients = [System.Collections.Generic.List[System.Net.Sockets.TcpClient]]::new()
try {
    $listener.Start()
    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()

    $partialClient = $listener.AcceptTcpClient()
    $clients.Add($partialClient)
    $partialStream = $partialClient.GetStream()
    Send-Frame -Stream $partialStream -Frame (New-SettingsFrame)
    $partial = New-DebugDatabaseFrame -Json '{"UStalePartial":{"properties":{},"methods":{}}}'
    $partialStream.Write($partial, 0, 7)
    $partialStream.Flush()
    $partialClient.Dispose()

    $invalidClient = $listener.AcceptTcpClient()
    $clients.Add($invalidClient)
    $invalidStream = $invalidClient.GetStream()
    Send-Frame -Stream $invalidStream -Frame (New-SettingsFrame)
    Send-Frame -Stream $invalidStream -Frame (New-DebugDatabaseFrame -Json '{"UInvalidRecovery":{"properties":{"Broken":null},"methods":{}}}')
    Send-Frame -Stream $invalidStream -Frame (New-Frame -Type 26 -Payload ([byte[]]::new(0)))
    $invalidClient.Dispose()

    $validClient = $listener.AcceptTcpClient()
    $clients.Add($validClient)
    $validStream = $validClient.GetStream()
    Send-Frame -Stream $validStream -Frame (New-SettingsFrame)
    Send-Frame -Stream $validStream -Frame (New-DebugDatabaseFrame -Json '{"URecoveredGeneration":{"properties":{},"methods":{}}}')
    Send-Frame -Stream $validStream -Frame (New-Frame -Type 26 -Payload ([byte[]]::new(0)))
    Start-Sleep -Milliseconds 1200
}
finally {
    foreach ($client in $clients) {
        $client.Dispose()
    }
    $listener.Stop()
}
