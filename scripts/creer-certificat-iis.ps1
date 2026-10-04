<#
  Crée un certificat HTTPS auto-signé pour IIS.
  À exécuter SUR LE SERVEUR IIS, dans PowerShell lancé en administrateur :

      .\creer-certificat-iis.ps1 -Noms "pythonstudio.ecole.local"

  -Noms : le ou les noms DNS par lesquels les étudiants accèdent au site
          (exactement ce qui est tapé dans la barre d'adresse).
          Une adresse IP ne convient pas : utilisez un nom.
#>
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Noms,
    [int]$ValiditeAnnees = 3
)

$cert = New-SelfSignedCertificate `
    -DnsName $Noms `
    -CertStoreLocation 'Cert:\LocalMachine\My' `
    -FriendlyName 'Python Studio (auto-signé)' `
    -NotAfter (Get-Date).AddYears($ValiditeAnnees) `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256

$fichier = Join-Path (Get-Location) 'pythonstudio.cer'
Export-Certificate -Cert $cert -FilePath $fichier | Out-Null

Write-Host ''
Write-Host "Certificat créé (empreinte : $($cert.Thumbprint))."
Write-Host "Copie publique exportée : $fichier"
Write-Host ''
Write-Host 'Étapes suivantes :'
Write-Host '  1. IIS : Sites > votre site > Liaisons > Ajouter > https > choisir "Python Studio (auto-signé)".'
Write-Host '  2. Installer pythonstudio.cer comme "Autorité de certification racine de confiance"'
Write-Host '     sur chaque poste (Windows : GPO ou double-clic > Installer > Racines de confiance ;'
Write-Host '     Chromebook : voir le README).'
