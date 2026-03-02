"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveQuizQuestions = saveQuizQuestions;
async function saveQuizQuestions(quizData, client, existingQuizId) {
    try {
        let quizId = existingQuizId;
        // 1. Criar ou Atualizar o quiz principal
        if (existingQuizId) {
            const { error: updateError } = await client
                .from('quiz')
                .update({
                title: quizData.title,
                description: quizData.description || 'Quiz gerado automaticamente',
                // Não atualizamos user_id ou analyzed_image_id pois devem ser iguais
            })
                .eq('id', existingQuizId);
            if (updateError)
                throw updateError;
        }
        else {
            const { data: newQuiz, error: quizError } = await client
                .from('quiz')
                .insert({
                user_id: quizData.userId,
                title: quizData.title,
                description: quizData.description || 'Quiz gerado automaticamente',
                analyzed_image_id: quizData.analyzedImageId || null
            })
                .select('id')
                .single();
            if (quizError)
                throw quizError;
            quizId = newQuiz.id;
        }
        if (!quizId)
            throw new Error("Falha ao determinar ID do Quiz");
        // 2. Preparar as questões para inserção
        const questionsToInsert = quizData.questions.map(question => ({
            quiz_id: quizId,
            question_text: question.question,
            options: question.options.map((option, index) => ({
                text: option,
                isCorrect: index === question.correctAnswer
            })),
            correct_option_index: question.correctAnswer,
            explanation: question.explanation,
            topic: question.topic,
            subtopic: question.subtopic || null
        }));
        // 3. Inserir todas as questões de uma vez
        const { error: questionsError } = await client
            .from('quiz_question')
            .insert(questionsToInsert);
        if (questionsError)
            throw questionsError;
        return {
            success: true,
            message: `Quiz "${quizData.title}" criado com ${quizData.questions.length} questões`,
            quizId: quizId,
            questionsInserted: quizData.questions.length
        };
    }
    catch (error) {
        console.error('Erro ao salvar quiz:', error);
        throw error;
    }
}
