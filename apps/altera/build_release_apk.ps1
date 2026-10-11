param(
    [Parameter(Mandatory = $true)]
    [string]$ApiUrl,

    [string]$SocketUrl = ""
)

$resolvedSocketUrl = if ([string]::IsNullOrWhiteSpace($SocketUrl)) { $ApiUrl } else { $SocketUrl }

flutter build apk --release --dart-define=API_URL=$ApiUrl --dart-define=SOCKET_URL=$resolvedSocketUrl
