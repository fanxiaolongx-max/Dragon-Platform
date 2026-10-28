import unittest, json, pathlib
from voice import spoken_text, cache_matches
class PronunciationTest(unittest.TestCase):
 def test_chong_preserves_zhong_and_caption_alignment(self):
  spec=json.loads((pathlib.Path(__file__).resolve().parents[1]/'specs/ai-monthly-guide.json').read_text())
  text='重复、重做、重画、重新；严重问题需要重视。'
  spoken=spoken_text(text,spec['pronunciations'])
  self.assertEqual(spoken,'崇复、崇做、崇画、崇新；严重问题需要重视。')
  self.assertEqual(len(text),len(spoken))
  for scene in spec['scenes']:
   self.assertNotIn('崇',scene['say'])
 def test_cache_invalidates_for_pronunciation_or_voice_changes(self):
  profile={'name':'zh-CN-XiaoxiaoNeural','rate':'-3%','pitch':'+0Hz'}
  saved={'text':'重新计算','spoken':'崇新计算','profile':profile}
  self.assertTrue(cache_matches(saved,'重新计算','崇新计算',profile))
  self.assertFalse(cache_matches(saved,'重新计算','重新计算',profile))
  self.assertFalse(cache_matches(saved,'重新计算','崇新计算',{**profile,'rate':'-5%'}))
  self.assertFalse(cache_matches({'text':'重新计算'},'重新计算','崇新计算',profile))
if __name__=='__main__':unittest.main()
