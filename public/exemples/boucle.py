# Posez un point d'arrêt en cliquant à gauche d'un numéro de ligne,
# puis observez le panneau « Variables » à chaque tour de boucle.
total = 0
for i in range(1, 6):
    total = total + i
    print("i =", i, " total =", total)

print("Somme de 1 à 5 :", total)
