def moyenne(notes):
    return sum(notes) / len(notes)


print(moyenne([12, 15, 9]))
print(moyenne([]))   # ZeroDivisionError : la ligne fautive sera soulignée
