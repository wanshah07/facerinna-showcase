import unittest
from pathlib import Path
class UIPolishTest(unittest.TestCase):
 def test_local_ui_dependencies_present(self):
  root=Path(__file__).parents[1]
  for name in ['lenis.min.js','motion.js','lucide.min.js','focus-visible.min.js']:
   self.assertTrue((root/'vendor'/name).is_file(),name)
 def test_reduced_motion_and_keyboard_focus_present(self):
  css=(Path(__file__).parents[1]/'fx-ui-polish.css').read_text()
  self.assertIn('prefers-reduced-motion',css)
  self.assertIn(':focus-visible',css)
if __name__=='__main__':unittest.main()
