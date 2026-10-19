const whisperModels=[
 ['tiny',77691713,'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',1],
 ['base',147951465,'60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',1.5],
 ['small',487601967,'1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',2.5],
 ['medium',1533763059,'6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',5],
 ['large-v3',3095033483,'64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2',8],
 ['large-v3-turbo',1624555275,'1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',5],
 ['large-v3-turbo-q5_0',574041195,'394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',2.5]
].map(([id,size,sha256,memoryGB])=>({id,name:`Whisper ${id}`,file:`ggml-${id}.bin`,size,sha256,memoryGB,repository:'ggerganov/whisper.cpp',license:'MIT',multilingual:true}));
const localModels=[
 {id:'qwen2.5-0.5b',name:'Qwen 2.5 0.5B Instruct · Q4',repository:'Qwen/Qwen2.5-0.5B-Instruct-GGUF',file:'qwen2.5-0.5b-instruct-q4_k_m.gguf',size:491400032,sha256:'74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',memoryGB:1.5,vision:false,license:'Apache-2.0'},
 {id:'smolvlm-500m',name:'SmolVLM 500M · texto e imagens',repository:'ggml-org/SmolVLM-500M-Instruct-GGUF',file:'SmolVLM-500M-Instruct-Q8_0.gguf',size:436806912,sha256:'9d4612de6a42214499e301494a3ecc2be0abdd9de44e663bda63f1152fad1bf4',memoryGB:2,vision:true,license:'Apache-2.0',projector:{file:'mmproj-SmolVLM-500M-Instruct-Q8_0.gguf',size:108783360,sha256:'d1eb8b6b23979205fdf63703ed10f788131a3f812c7b1f72e0119d5d81295150'}}
];
module.exports={whisperModels,localModels};
