const BOOK_COVER_URLS = {
  "9-biology": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G9%20Biology.png",
  "9-chemistry": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G9%20Chemistry.png",
  "9-math": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G9%20Maths.png",
  "9-physics": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G9%20Physics.png",
  "10-biology": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G10%20Biology.png",
  "10-chemistry": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G10%20Chemistry.png",
  "10-math": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G10%20Maths.png",
  "10-physics": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G10%20Physics.png",
  "11-biology": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G11%20Biology.png",
  "11-chemistry": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G11%20Chemistry.png",
  "11-math": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G11%20Maths.png",
  "11-physics": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G11%20Physics.png",
  "12-biology": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G12%20Biology.png",
  "12-chemistry": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G12%20Chemistry.png",
  "12-math": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G12%20Maths.png",
  "12-physics": "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/book_cover_page/G12%20Physics.png",
};

const coverFor = (subject, grade) => {
  const key = `${String(grade)}-${String(subject).toLowerCase()}`;
  return BOOK_COVER_URLS[key] || null;
};

const textbookCatalog = [
  {
    subject: "biology",
    grade: 9,
    title: "Biology Grade 9 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/G9-Biology-STB-2023-web.pdf",
    cover_image_url: coverFor("biology", 9),
  },
  {
    subject: "biology",
    grade: 10,
    title: "Biology Grade 10 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Biology%20Grade%2010%20ST%20(MT)(BOOK).pdf",
    cover_image_url: coverFor("biology", 10),
  },
  {
    subject: "biology",
    grade: 11,
    title: "Biology Grade 11 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/G11-Biology-STB-2023-web.pdf",
    cover_image_url: coverFor("biology", 11),
  },
  {
    subject: "biology",
    grade: 12,
    title: "Biology Grade 12 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Biology%20Grade%2012%20New%20Textbook.pdf",
    cover_image_url: coverFor("biology", 12),
  },
  {
    subject: "chemistry",
    grade: 9,
    title: "Chemistry Grade 9 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/G9-Chemistry-STB-2023-web.pdf",
    cover_image_url: coverFor("chemistry", 9),
  },
  {
    subject: "chemistry",
    grade: 10,
    title: "Chemistry Grade 10 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Chemistry%20Grade%2010%20ST%20(MT)(BOOK).pdf",
    cover_image_url: coverFor("chemistry", 10),
  },
  {
    subject: "chemistry",
    grade: 11,
    title: "Chemistry Grade 11 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/G11-Chemistry-STB-2023-web.pdf",
    cover_image_url: coverFor("chemistry", 11),
  },
  {
    subject: "chemistry",
    grade: 12,
    title: "Chemistry Grade 12 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Chemistry%20Grade%2012%20new%20textbook.pdf",
    cover_image_url: coverFor("chemistry", 12),
  },
  {
    subject: "physics",
    grade: 9,
    title: "Physics Grade 9 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/G9-Physics-STB-2023-web.pdf",
    cover_image_url: coverFor("physics", 9),
  },
  {
    subject: "physics",
    grade: 11,
    title: "Physics Grade 11 Student Textbook Unit 3",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Grade11_Physics_Unit3.pdf",
    cover_image_url: coverFor("physics", 11),
  },
  {
    subject: "physics",
    grade: 12,
    title: "Physics Grade 12 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Physics%20Grade%2012%20new%20textbook.pdf",
    cover_image_url: coverFor("physics", 12),
  },
  {
    subject: "math",
    grade: 9,
    title: "Mathematics Grade 9 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/G9-Mathematics-STB-2023-web.pdf",
    cover_image_url: coverFor("math", 9),
  },
  {
    subject: "math",
    grade: 10,
    title: "Mathematics Grade 10 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Maths%20Grade%2010%20Students%20Textbook%201Aug22.pdf",
    cover_image_url: coverFor("math", 10),
  },
  {
    subject: "math",
    grade: 12,
    title: "Mathematics Grade 12 Student Textbook",
    pdf_url:
      "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/Maths%20Grade%2012%20New%20textbook%20@Ethiopian_Digital_Library.pdf",
    cover_image_url: coverFor("math", 12),
  },
];

module.exports = textbookCatalog;
