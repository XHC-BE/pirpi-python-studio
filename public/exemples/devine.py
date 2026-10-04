import random

secret = random.randint(1, 20)
essais = 0

print("J'ai choisi un nombre entre 1 et 20.")
while True:
    proposition = int(input("Votre proposition : "))
    essais += 1
    if proposition < secret:
        print("Trop petit !")
    elif proposition > secret:
        print("Trop grand !")
    else:
        print(f"Bravo, trouvé en {essais} essai(s) !")
        break
