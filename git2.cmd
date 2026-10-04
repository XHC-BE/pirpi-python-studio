if %1.==. Goto End
cd P:\PythonWebEditor
git add .
git commit -m %1
git push
:End