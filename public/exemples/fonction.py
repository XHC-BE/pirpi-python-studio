# Utilisez « Étape suivante », « Entrer » et « Sortir »
# pour suivre les appels et la pile d'appels.
def factorielle(n):
    if n <= 1:
        return 1
    resultat = n * factorielle(n - 1)
    return resultat


def carre(x):
    return x * x


valeur = 4
print("carré :", carre(valeur))
print("factorielle :", factorielle(valeur))
