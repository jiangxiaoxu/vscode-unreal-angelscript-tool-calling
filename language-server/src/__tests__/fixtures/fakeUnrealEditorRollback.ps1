param(
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [Parameter(Mandatory = $true)][int]$Port
)

function Send-Frame {
    param([System.Net.Sockets.NetworkStream]$Stream, [byte]$Type, [byte[]]$Payload)
    $header = [System.BitConverter]::GetBytes([uint32]$Payload.Length)
    $Stream.Write($header, 0, $header.Length)
    $Stream.WriteByte($Type)
    if ($Payload.Length -gt 0) {
        $Stream.Write($Payload, 0, $Payload.Length)
    }
    $Stream.Flush()
}

function Send-Round {
    param([System.Net.Sockets.NetworkStream]$Stream, [string]$Json)
    $settings = [byte[]]::new(36)
    [System.Array]::Copy([System.BitConverter]::GetBytes([int]7), 0, $settings, 0, 4)
    Send-Frame -Stream $Stream -Type 31 -Payload $settings
    $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $stringLength = [System.BitConverter]::GetBytes([int]($jsonBytes.Length + 1))
    $payload = [byte[]]::new($stringLength.Length + $jsonBytes.Length + 1)
    [System.Array]::Copy($stringLength, 0, $payload, 0, $stringLength.Length)
    [System.Array]::Copy($jsonBytes, 0, $payload, $stringLength.Length, $jsonBytes.Length)
    Send-Frame -Stream $Stream -Type 2 -Payload $payload
    Send-Frame -Stream $Stream -Type 26 -Payload ([byte[]]::new(0))
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
$client = $null
try {
    $listener.Start()
    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    Send-Round -Stream $stream -Json '{"URestoredActive":{"properties":{},"methods":{}}}'
    Send-Round -Stream $stream -Json '{"UInvalidReplacement":{"properties":{"Broken":null},"methods":{}}}'
    Start-Sleep -Milliseconds 1200
}
finally {
    if ($null -ne $client) {
        $client.Dispose()
    }
    $listener.Stop()
}
